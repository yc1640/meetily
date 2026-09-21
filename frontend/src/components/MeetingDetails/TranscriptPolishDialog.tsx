"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAppLanguage } from '@/contexts/AppLanguageContext';
import { useConfig } from '@/contexts/ConfigContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TranscriptPolishSegment {
  id: string;
  timestamp: string;
  originalText: string;
  previousPolishedText?: string;
  polishedText: string;
}

interface TranscriptPolishPreview {
  segments: TranscriptPolishSegment[];
  changedCount: number;
  modelProvider: string;
  modelName: string;
}

interface ApplyTranscriptPolishResponse {
  changedCount: number;
}

interface TranscriptPolishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  onComplete?: () => Promise<void> | void;
}

type DialogStep = 'intro' | 'processing' | 'preview' | 'applying' | 'error';

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function TranscriptPolishDialog({
  open,
  onOpenChange,
  meetingId,
  onComplete,
}: TranscriptPolishDialogProps) {
  const { t } = useAppLanguage();
  const { modelConfig } = useConfig();
  const [step, setStep] = useState<DialogStep>('intro');
  const [preview, setPreview] = useState<TranscriptPolishPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operationIdRef = useRef(0);
  const previousOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (open && !wasOpen) {
      operationIdRef.current += 1;
      setStep('intro');
      setPreview(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => () => {
    operationIdRef.current += 1;
    void invoke('api_cancel_transcript_polish', { meetingId }).catch(() => undefined);
  }, [meetingId]);

  const changedSegments = useMemo(
    () => preview?.segments.filter((segment) => segment.originalText !== segment.polishedText) ?? [],
    [preview],
  );

  const configuredModelName = modelConfig.provider === 'custom-openai'
    ? modelConfig.customOpenAIModel || modelConfig.model
    : modelConfig.model;
  const displayProvider = preview?.modelProvider || modelConfig.provider;
  const displayModel = preview?.modelName || configuredModelName;

  const startPolishing = async () => {
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    setStep('processing');
    setError(null);
    setPreview(null);

    try {
      const result = await invoke<TranscriptPolishPreview>('api_polish_transcript_preview', {
        meetingId,
      });
      if (operationIdRef.current !== operationId) return;
      setPreview(result);
      setStep('preview');
    } catch (cause) {
      if (operationIdRef.current !== operationId) return;
      const message = errorMessage(cause);
      if (message.toLowerCase().includes('cancel')) {
        setStep('intro');
        return;
      }
      setError(message);
      setStep('error');
    }
  };

  const cancelPolishing = () => {
    operationIdRef.current += 1;
    void invoke('api_cancel_transcript_polish', { meetingId }).catch((cause) => {
      console.error('Failed to cancel transcript polishing:', cause);
    });
    onOpenChange(false);
  };

  const applyPreview = async () => {
    if (!preview) return;
    setStep('applying');
    setError(null);

    try {
      const result = await invoke<ApplyTranscriptPolishResponse>('api_apply_polished_transcript', {
        meetingId,
        segments: preview.segments,
      });
      try {
        await onComplete?.();
      } catch (refreshError) {
        console.error('Transcript was updated but could not be refreshed:', refreshError);
      }
      toast.success(t('polishTranscriptApplied'), {
        description: `${result.changedCount} ${t('changedSegments')}`,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause));
      setStep('error');
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (step === 'processing') {
      cancelPolishing();
      return;
    }
    if (step === 'applying') return;
    onOpenChange(false);
  };

  const showPreview = (step === 'preview' || step === 'applying') && preview;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'processing' || step === 'applying' ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
            ) : step === 'error' ? (
              <AlertCircle className="h-5 w-5 text-red-600" aria-hidden="true" />
            ) : showPreview ? (
              <FileCheck2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Sparkles className="h-5 w-5 text-blue-600" aria-hidden="true" />
            )}
            {showPreview ? t('polishTranscriptPreview') : t('polishTranscript')}
          </DialogTitle>
          <DialogDescription>
            {step === 'processing'
              ? t('polishingTranscriptDescription')
              : showPreview
                ? t('polishTranscriptPreviewDescription')
                : t('polishTranscriptDialogDescription')}
          </DialogDescription>
        </DialogHeader>

        {step === 'intro' && (
          <div className="space-y-4 py-2">
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{t('polishTranscriptCleansSpeech')}</span>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{t('polishTranscriptKeepsStructure')}</span>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>{t('polishTranscriptNoSummary')}</span>
              </div>
            </div>

            <div className="space-y-1 text-sm">
              <p className="font-medium text-gray-900">{t('currentSummaryModel')}</p>
              <p className="text-gray-600">
                {displayProvider}{displayModel ? ` · ${displayModel}` : ''}
              </p>
              <p className="text-xs leading-5 text-gray-500">{t('polishTranscriptModelHint')}</p>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{t('polishTranscriptSummaryUnaffected')}</AlertDescription>
            </Alert>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-gray-900">{t('polishingTranscript')}</p>
              <p className="max-w-md text-sm leading-6 text-gray-500">
                {t('polishingTranscriptDescription')}
              </p>
            </div>
          </div>
        )}

        {showPreview && (
          <div className="min-h-0 flex-1 space-y-3 py-2">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-gray-900">
                {preview.changedCount} {t('changedSegments')}
              </span>
              <span className="truncate text-xs text-gray-500">
                {preview.modelProvider} · {preview.modelName}
              </span>
            </div>

            {changedSegments.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
                <p className="font-medium text-gray-900">{t('noPolishChanges')}</p>
              </div>
            ) : (
              <ScrollArea className="h-[min(52vh,34rem)] pr-4">
                <div className="space-y-4">
                  {changedSegments.map((segment) => (
                    <section key={segment.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
                      <p className="text-xs font-medium tabular-nums text-gray-500">
                        {segment.timestamp}
                      </p>
                      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-gray-500">{t('originalTranscript')}</p>
                          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                            {segment.originalText}
                          </p>
                        </div>
                        <ArrowRight
                          className="mt-7 hidden h-4 w-4 text-gray-400 md:block"
                          aria-hidden="true"
                        />
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-blue-700">{t('polishedTranscript')}</p>
                          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-900">
                            {segment.polishedText}
                          </p>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {step === 'error' && (
          <div className="py-3">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>{t('polishTranscriptFailed')}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{t('polishTranscriptFailedDescription')}</p>
                {error && <p className="break-words text-xs opacity-90">{error}</p>}
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          {step === 'intro' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={startPolishing}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('startPolishing')}
              </Button>
            </>
          )}
          {step === 'processing' && (
            <Button variant="outline" onClick={cancelPolishing}>
              {t('cancelPolishing')}
            </Button>
          )}
          {showPreview && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={step === 'applying'}>
                {t('cancel')}
              </Button>
              {changedSegments.length > 0 && (
                <Button onClick={applyPreview} disabled={step === 'applying'}>
                  {step === 'applying' && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {step === 'applying' ? t('applyingPolishedTranscript') : t('applyPolishedTranscript')}
                </Button>
              )}
            </>
          )}
          {step === 'error' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={startPolishing}>{t('retry')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
