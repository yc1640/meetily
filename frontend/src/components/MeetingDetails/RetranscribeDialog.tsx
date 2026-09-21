import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Globe, Loader2, AlertCircle, CheckCircle2, X, Cpu, Clock3 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { LANGUAGES } from '@/constants/languages';
import { useTranscriptionModels, ModelOption } from '@/hooks/useTranscriptionModels';
import Analytics from '@/lib/analytics';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

export interface RetranscriptionSegmentTarget {
  id: string;
  originalText: string;
  startTime: number;
  endTime: number;
}

interface RetranscribeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  meetingFolderPath: string | null;
  segment?: RetranscriptionSegmentTarget | null;
  onComplete?: () => Promise<void> | void;
}

interface RetranscriptionProgress {
  meeting_id: string;
  stage: string;
  progress_percentage: number;
  message: string;
}

interface RetranscriptionResult {
  meeting_id: string;
  segments_count: number;
  duration_seconds: number;
  language: string | null;
}

interface RetranscriptionError {
  meeting_id: string;
  error: string;
}

interface SegmentRetranscriptionResult {
  meeting_id: string;
  segment_id: string;
  text: string;
  confidence: number;
  audio_start_time: number;
  audio_end_time: number;
}

function formatRangeTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
}

export function RetranscribeDialog({
  open,
  onOpenChange,
  meetingId,
  meetingFolderPath,
  segment,
  onComplete,
}: RetranscribeDialogProps) {
  const { selectedLanguage, transcriptModelConfig } = useConfig();
  const { appLanguage, t } = useAppLanguage();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<RetranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState(selectedLanguage || 'auto');
  const operationIdRef = useRef(0);
  const isSegmentMode = Boolean(segment);

  // Use centralized model fetching hook
  const {
    availableModels,
    selectedModelKey,
    setSelectedModelKey,
    loadingModels,
    fetchModels,
    resetSelection,
  } = useTranscriptionModels(transcriptModelConfig);

  // Stable refs for callbacks to avoid listener re-registration
  const onCompleteRef = useRef(onComplete);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);

  // Track previous open state to only reset on closed→open transition
  const prevOpenRef = useRef(false);

  // Helper to get selected model details (memoized)
  const selectedModelDetails = useMemo((): ModelOption | undefined => {
    if (!selectedModelKey) return undefined;
    const colonIndex = selectedModelKey.indexOf(':');
    if (colonIndex === -1) return undefined;
    const provider = selectedModelKey.slice(0, colonIndex);
    const name = selectedModelKey.slice(colonIndex + 1);
    return availableModels.find(m => m.provider === provider && m.name === name);
  }, [selectedModelKey, availableModels]);
  const isParakeetModel = selectedModelDetails?.provider === 'parakeet';
  const isFunAsrLocalModel = selectedModelDetails?.provider === 'funasrLocal';
  const isQwen3AsrModel = selectedModelDetails?.provider === 'qwen3Asr';
  const keepsOriginalLanguage =
    isFunAsrLocalModel || isQwen3AsrModel || selectedModelDetails?.provider === 'funasr';
  const availableLanguages = useMemo(() => {
    if (isParakeetModel || isFunAsrLocalModel) {
      return LANGUAGES.filter((language) => language.code === 'auto');
    }
    if (isQwen3AsrModel) {
      const supported = new Set(['auto', 'zh', 'yue', 'en', 'de', 'es', 'fr', 'it', 'pt', 'ru', 'ko', 'ja']);
      return LANGUAGES.filter((language) => supported.has(language.code));
    }
    if (keepsOriginalLanguage) {
      return LANGUAGES.filter((language) => language.code !== 'auto-translate');
    }
    return LANGUAGES;
  }, [isFunAsrLocalModel, isParakeetModel, isQwen3AsrModel, keepsOriginalLanguage]);
  const languageDisplayNames = useMemo(
    () => new Intl.DisplayNames([appLanguage], { type: 'language' }),
    [appLanguage],
  );

  useEffect(() => {
    if ((isParakeetModel || isFunAsrLocalModel) && selectedLang !== 'auto') {
      setSelectedLang('auto');
    } else if (keepsOriginalLanguage && selectedLang === 'auto-translate') {
      setSelectedLang('auto');
    }
  }, [isFunAsrLocalModel, isParakeetModel, keepsOriginalLanguage, selectedLang]);

  // Reset state only when dialog transitions from closed to open
  // This prevents re-initialization when config changes while dialog is already open
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (open && !wasOpen) {
      operationIdRef.current += 1;
      resetSelection();
      setIsProcessing(false);
      setProgress(null);
      setError(null);
      setSelectedLang(selectedLanguage || 'auto');

      // Fetch available models using centralized hook
      fetchModels();
    }
  }, [open, selectedLanguage, transcriptModelConfig, fetchModels]);

  // Listen for retranscription events
  useEffect(() => {
    if (!open || isSegmentMode) return;

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Progress events
      const unlistenProgress = await listen<RetranscriptionProgress>(
        'retranscription-progress',
        (event) => {
          if (event.payload.meeting_id === meetingId) {
            setProgress(event.payload);
          }
        }
      );
      if (cleanedUpRef.current) {
        unlistenProgress();
        return;
      }
      unlisteners.push(unlistenProgress);

      // Completion event
      const unlistenComplete = await listen<RetranscriptionResult>(
        'retranscription-complete',
        async (event) => {
          if (event.payload.meeting_id === meetingId) {
            await Analytics.track('enhance_transcript_completed', {
              success: 'true',
              duration_seconds: event.payload.duration_seconds.toString(),
              segments_count: event.payload.segments_count.toString()
            });

            setIsProcessing(false);
            toast.success(t('retranscriptionComplete'), {
              description: `${event.payload.segments_count} ${t('segments')}`,
            });
            try {
              await onCompleteRef.current?.();
            } catch (refreshError) {
              console.error('Meeting was retranscribed but the transcript view could not be refreshed:', refreshError);
            }
            onOpenChangeRef.current(false);
          }
        }
      );
      if (cleanedUpRef.current) {
        unlistenComplete();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenComplete);

      // Error event
      const unlistenError = await listen<RetranscriptionError>(
        'retranscription-error',
        async (event) => {
          if (event.payload.meeting_id === meetingId) {
            await Analytics.trackError('enhance_transcript_failed', event.payload.error);

            setIsProcessing(false);
            setError(event.payload.error);
          }
        }
      );
      if (cleanedUpRef.current) {
        unlistenError();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenError);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [open, meetingId, t, isSegmentMode]);

  const handleStartRetranscription = async () => {
    if (!meetingFolderPath) {
      setError(t('meetingFolderUnavailable'));
      return;
    }

    if (!selectedModelDetails) {
      setError(t('chooseTranscriptionModel'));
      return;
    }

    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setIsProcessing(true);
    setError(null);
    setProgress(null);

    try {
      const usesAutomaticLanguage = isParakeetModel || isFunAsrLocalModel;
      const languageToSend = usesAutomaticLanguage || selectedLang === 'auto' ? null : selectedLang;
      await Analytics.track(isSegmentMode ? 'segment_retranscription_started' : 'enhance_transcript_started', {
        language: usesAutomaticLanguage ? 'auto' : (selectedLang === 'auto' ? 'auto' : selectedLang),
        model_provider: selectedModelDetails?.provider || '',
        model_name: selectedModelDetails?.name || ''
      });

      if (segment) {
        const result = await invoke<SegmentRetranscriptionResult>('retranscribe_segment_command', {
          meetingId,
          segmentId: segment.id,
          expectedOriginalText: segment.originalText,
          language: languageToSend,
          model: selectedModelDetails.name,
          provider: selectedModelDetails.provider,
        });
        if (operationIdRef.current !== operationId) return;

        await Analytics.track('segment_retranscription_completed', {
          success: 'true',
          duration_seconds: (result.audio_end_time - result.audio_start_time).toString(),
          model_provider: selectedModelDetails.provider,
          model_name: selectedModelDetails.name,
        });
        try {
          await onCompleteRef.current?.();
        } catch (refreshError) {
          console.error('Segment was retranscribed but the transcript view could not be refreshed:', refreshError);
        }
        if (operationIdRef.current !== operationId) return;
        setIsProcessing(false);
        toast.success(t('segmentRetranscriptionComplete'));
        onOpenChangeRef.current(false);
      } else {
        await invoke('start_retranscription_command', {
          meetingId,
          meetingFolderPath,
          language: languageToSend,
          model: selectedModelDetails.name,
          provider: selectedModelDetails.provider,
        });
      }
    } catch (err: any) {
      if (operationIdRef.current !== operationId) return;
      setIsProcessing(false);
      const errorMsg = typeof err === 'string' ? err : (err?.message || String(err));
      setError(errorMsg);

      await Analytics.trackError(
        isSegmentMode ? 'segment_retranscription_failed' : 'enhance_transcript_failed',
        errorMsg,
      );
    }
  };

  const handleCancel = async () => {
    if (isProcessing) {
      operationIdRef.current += 1;
      try {
        await invoke('cancel_retranscription_command');
        setIsProcessing(false);
        setProgress(null);
        toast.info(t('retranscriptionCancelled'));
      } catch (err) {
        console.error('Failed to cancel retranscription:', err);
      }
    }
    onOpenChange(false);
  };

  // Prevent closing during processing
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isProcessing) {
      return;
    }
    onOpenChange(newOpen);
  };

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  const handleInteractOutside = (event: Event) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[450px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isProcessing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                {isSegmentMode ? t('retranscribingSegment') : t('retranscribing')}
              </>
            ) : error ? (
              <>
                <AlertCircle className="h-5 w-5 text-red-600" />
                {isSegmentMode ? t('segmentRetranscriptionFailed') : t('retranscriptionFailed')}
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 text-blue-600" />
                {isSegmentMode ? t('retranscribeSegment') : t('retranscribeMeeting')}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isProcessing
              ? progress?.message || (isSegmentMode ? t('retranscribingSegmentDescription') : t('processingAudio'))
              : error
                ? (isSegmentMode ? t('segmentRetranscriptionErrorDescription') : t('retranscriptionErrorDescription'))
                : (isSegmentMode ? t('retranscribeSegmentDescription') : t('retranscribeDescription'))}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isProcessing && !error && segment && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <Clock3 className="h-4 w-4" aria-hidden="true" />
                <span>
                  {t('selectedAudioRange')} {formatRangeTime(segment.startTime)}–{formatRangeTime(segment.endTime)}
                </span>
              </div>
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-gray-800">
                {segment.originalText}
              </p>
              <p className="text-xs leading-5 text-gray-500">
                {t('segmentRetranscriptionDataNotice')}
              </p>
            </div>
          )}

          {!isProcessing && !error && (
            !isParakeetModel && !isFunAsrLocalModel ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('language')}</span>
                </div>
                <Select value={selectedLang} onValueChange={setSelectedLang}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('selectLanguage')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {availableLanguages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.code === 'auto'
                          ? t('autoDetectOriginal')
                          : lang.code === 'auto-translate'
                            ? t('autoTranslateEnglish')
                            : languageDisplayNames.of(lang.code) || lang.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('specificLanguageHint')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('language')}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isFunAsrLocalModel
                    ? t('funasrLocalLanguageDescription')
                    : t('parakeetRetranscriptionLanguage')}
                </p>
              </div>
            )
          )}

          {!isProcessing && !error && availableModels.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t('model')}</span>
              </div>
              <Select value={selectedModelKey} onValueChange={setSelectedModelKey} disabled={loadingModels}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loadingModels ? t('loadingModels') : t('selectModel')} />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={`${model.provider}:${model.name}`} value={`${model.provider}:${model.name}`}>
                      {model.displayName}
                      {model.size_mb !== undefined && ` (${Math.round(model.size_mb)} MB)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('chooseTranscriptionModel')}
              </p>
            </div>
          )}

          {!isProcessing && !error && !loadingModels && availableModels.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {t('noTranscriptionModelsAvailable')}
            </div>
          )}

          {isProcessing && isSegmentMode && (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" aria-hidden="true" />
              <p className="text-sm text-gray-600">{t('retranscribingSegmentDescription')}</p>
            </div>
          )}

          {isProcessing && progress && (
            <div className="space-y-2">
              <div className="relative">
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(progress.progress_percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>{progress.stage}</span>
                  <span>{Math.round(progress.progress_percentage)}%</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {progress.message}
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!isProcessing && !error && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={handleStartRetranscription}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!meetingFolderPath || loadingModels || !selectedModelDetails}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {isSegmentMode ? t('startSegmentRetranscription') : t('startRetranscription')}
              </Button>
            </>
          )}
          {isProcessing && (
            <Button variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" />
              {t('cancel')}
            </Button>
          )}
          {error && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('close')}
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  setProgress(null);
                }}
                variant="outline"
              >
                {t('tryAgain')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
