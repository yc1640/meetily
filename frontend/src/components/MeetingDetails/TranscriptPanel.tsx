"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import {
  RetranscribeDialog,
  RetranscriptionSegmentTarget,
} from './RetranscribeDialog';
import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAppLanguage } from '@/contexts/AppLanguageContext';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  const { t } = useAppLanguage();
  const [viewMode, setViewMode] = useState<'original' | 'polished'>('polished');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [retranscriptionTarget, setRetranscriptionTarget] = useState<RetranscriptionSegmentTarget | null>(null);

  useEffect(() => {
    setViewMode('polished');
    setShowRestoreDialog(false);
    setRetranscriptionTarget(null);
  }, [meetingId]);

  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      originalText: t.original_text ?? t.text,
      polishedText: t.polished_text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  const hasPolishedTranscript = useMemo(
    () => convertedSegments.some((segment) => segment.polishedText !== undefined),
    [convertedSegments],
  );

  const displayedSegments = useMemo(
    () => convertedSegments.map((segment) => ({
      ...segment,
      text: viewMode === 'original'
        ? segment.originalText ?? segment.text
        : segment.polishedText ?? segment.originalText ?? segment.text,
    })),
    [convertedSegments, viewMode],
  );

  const restoreOriginalTranscript = async () => {
    if (!meetingId) return;
    setIsRestoring(true);
    try {
      await invoke('api_clear_polished_transcript', { meetingId });
      setViewMode('original');
      setShowRestoreDialog(false);
      toast.success(t('originalTranscriptRestored'));
      try {
        await onRefetchTranscripts?.();
      } catch (refreshError) {
        console.error('Original transcript was restored but the view could not be refreshed:', refreshError);
      }
    } catch (error) {
      console.error('Failed to restore original transcript:', error);
      toast.error(t('restoreOriginalTranscriptFailed'), {
        description: typeof error === 'string' ? error : String(error),
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-0 border-r border-gray-200 bg-white flex-col relative shrink-0">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />

        {hasPolishedTranscript && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ButtonGroup aria-label={t('transcriptVersion')}>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === 'original' ? 'secondary' : 'outline'}
                  aria-pressed={viewMode === 'original'}
                  onClick={() => setViewMode('original')}
                >
                  <FileText aria-hidden="true" />
                  {t('originalVersion')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={viewMode === 'polished' ? 'secondary' : 'outline'}
                  aria-pressed={viewMode === 'polished'}
                  onClick={() => setViewMode('polished')}
                >
                  <Sparkles aria-hidden="true" />
                  {t('polishedVersion')}
                </Button>
              </ButtonGroup>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowRestoreDialog(true)}
              >
                <RotateCcw aria-hidden="true" />
                {t('undoTranscriptPolish')}
              </Button>
            </div>
            <p className="text-xs leading-5 text-gray-500">
              {t('polishedTranscriptUsedByDefault')}
            </p>
          </div>
        )}
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={displayedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          preserveText={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          onRetranscribeSegment={meetingId && meetingFolderPath ? (segment) => {
            if (segment.endTime === undefined || segment.endTime <= segment.timestamp) return;
            setRetranscriptionTarget({
              id: segment.id,
              originalText: segment.originalText ?? segment.text,
              startTime: segment.timestamp,
              endTime: segment.endTime,
            });
          } : undefined}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-200 p-3">
          <label htmlFor="summary-extra-instructions" className="block text-xs font-medium text-gray-700">
            {t('summaryContextLabel')}
          </label>
          <textarea
            id="summary-extra-instructions"
            placeholder={t('summaryContextPlaceholder')}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
          <p className="text-xs leading-4 text-gray-500">{t('summaryContextHelp')}</p>
        </div>
      )}

      <Dialog open={showRestoreDialog} onOpenChange={(open) => !isRestoring && setShowRestoreDialog(open)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('restoreOriginalTranscript')}</DialogTitle>
            <DialogDescription>{t('restoreOriginalTranscriptDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreDialog(false)} disabled={isRestoring}>
              {t('cancel')}
            </Button>
            <Button onClick={restoreOriginalTranscript} disabled={isRestoring}>
              {isRestoring && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isRestoring ? t('restoringOriginalTranscript') : t('confirmRestoreOriginalTranscript')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {meetingId && meetingFolderPath && (
        <RetranscribeDialog
          open={retranscriptionTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRetranscriptionTarget(null);
          }}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          segment={retranscriptionTarget}
          onComplete={onRefetchTranscripts}
        />
      )}
    </div>
  );
}
