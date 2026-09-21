"use client";

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, FolderOpen, RefreshCw, Sparkles } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { RetranscribeDialog } from './RetranscribeDialog';
import { TranscriptPolishDialog } from './TranscriptPolishDialog';
import { useConfig } from '@/contexts/ConfigContext';
import { useAppLanguage } from '@/contexts/AppLanguageContext';


interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}


export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptButtonGroupProps) {
  const { betaFeatures } = useConfig();
  const { t } = useAppLanguage();
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);
  const [showPolishDialog, setShowPolishDialog] = useState(false);

  const handleRetranscribeComplete = useCallback(async () => {
    // Refetch transcripts to show the updated data
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
  }, [onRefetchTranscripts]);

  return (
    <div className="flex items-center justify-center w-full gap-2">
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('copy_transcript', 'meeting_details');
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? t('noTranscriptAvailable') : t('copyTranscript')}
        >
          <Copy />
          <span className="hidden 2xl:inline">{t('copy')}</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
            onOpenMeetingFolder();
          }}
          title={t('openRecordingFolder')}
        >
          <FolderOpen className="xl:mr-2" size={18} />
          <span className="hidden 2xl:inline">{t('recordingFile')}</span>
        </Button>

        {meetingId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              Analytics.trackButtonClick('polish_transcript', 'meeting_details');
              setShowPolishDialog(true);
            }}
            disabled={transcriptCount === 0}
            title={t('polishTranscriptButtonDescription')}
          >
            <Sparkles size={18} />
            <span className="hidden 2xl:inline">{t('polishTranscript')}</span>
          </Button>
        )}

        {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
          <Button
            size="sm"
            variant="outline"
            className="bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border-blue-200 xl:px-4"
            onClick={() => {
              Analytics.trackButtonClick('enhance_transcript', 'meeting_details');
              setShowRetranscribeDialog(true);
            }}
            title={t('enhanceTranscriptDescription')}
          >
            <RefreshCw className="xl:mr-2" size={18} />
            <span className="hidden 2xl:inline">{t('enhanceTranscript')}</span>
          </Button>
        )}
      </ButtonGroup>

      {meetingId && (
        <TranscriptPolishDialog
          open={showPolishDialog}
          onOpenChange={setShowPolishDialog}
          meetingId={meetingId}
          onComplete={onRefetchTranscripts}
        />
      )}

      {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
        <RetranscribeDialog
          open={showRetranscribeDialog}
          onOpenChange={setShowRetranscribeDialog}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onComplete={handleRetranscribeComplete}
        />
      )}
    </div>
  );
}
