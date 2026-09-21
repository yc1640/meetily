import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { t } = useAppLanguage();
  const {
    isRecording,
    isPaused,
    transcriptionEnabled: sessionTranscriptionEnabled,
  } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(true);

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const preferences = await invoke<{ transcription_enabled: boolean }>('get_recording_preferences');
        setTranscriptionEnabled(preferences.transcription_enabled);
      } catch (error) {
        console.error('Failed to load transcription preference:', error);
      }
    };
    const handlePreferenceChange = (event: Event) => {
      const preferences = (event as CustomEvent<{ transcription_enabled: boolean }>).detail;
      if (preferences) setTranscriptionEnabled(preferences.transcription_enabled);
    };
    loadPreferences();
    window.addEventListener('recording-preferences-updated', handlePreferenceChange);
    return () => window.removeEventListener('recording-preferences-updated', handlePreferenceChange);
  }, []);

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  return (
    <div ref={transcriptContainerRef} className="w-full border-r border-gray-200 bg-white flex flex-col overflow-y-auto">
      {/* Title area - Sticky header */}
      <div className="sticky top-0 z-10 bg-white p-4 border-gray-200">
        <div className="flex flex-col space-y-3">
          <div className="flex  flex-col space-y-2">
            <div className="flex justify-center  items-center space-x-2">
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title={t('copyTranscript')}
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      {t('copy')}
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider !== "parakeet" && transcriptModelConfig.provider !== "funasrLocal" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title={t('language')}
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      {t('language')}
                    </span>
                  </Button>
                }
              </ButtonGroup>
            </div>
          </div>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-4 pt-4">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      <div className="pb-20">
        <div className="flex justify-center">
          <div className="w-2/3 max-w-[750px]">
            <VirtualizedTranscriptView
              segments={segments}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessingStop}
              isStopping={isStopping}
              enableStreaming={isRecording}
              showConfidence={true}
              isTranscriptionEnabled={isRecording ? sessionTranscriptionEnabled : transcriptionEnabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
