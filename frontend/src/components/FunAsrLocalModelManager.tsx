import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Download, HardDrive, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

interface FunAsrLocalStatus {
  supported: boolean;
  is_ready: boolean;
  model_ready: boolean;
  runtime_ready: boolean;
  is_downloading: boolean;
  model_name: string;
  model_size_mb: number;
  runtime_size_mb: number;
}

interface FunAsrLocalDownloadProgress {
  progress: number;
}

interface FunAsrLocalModelManagerProps {
  onModelSelect: (modelName: string) => Promise<void>;
}

export function FunAsrLocalModelManager({ onModelSelect }: FunAsrLocalModelManagerProps) {
  const { t } = useAppLanguage();
  const [status, setStatus] = useState<FunAsrLocalStatus | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await invoke<FunAsrLocalStatus>('funasr_local_get_status');
      setStatus(nextStatus);
      setIsDownloading(nextStatus.is_downloading);
    } catch (error) {
      console.error('Failed to load FunASR local model status:', error);
    }
  }, []);

  useEffect(() => {
    void loadStatus();

    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const registerListeners = async () => {
      unlistenProgress = await listen<FunAsrLocalDownloadProgress>(
        'funasr-local-download-progress',
        (event) => setProgress(event.payload.progress),
      );
      unlistenComplete = await listen('funasr-local-download-complete', () => {
        setProgress(100);
        setIsDownloading(false);
        void loadStatus();
      });
      unlistenError = await listen('funasr-local-download-error', () => {
        setIsDownloading(false);
        void loadStatus();
      });
    };

    void registerListeners();
    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, [loadStatus]);

  const downloadModel = async () => {
    setIsDownloading(true);
    setProgress(0);
    try {
      await invoke('funasr_local_download_model');
      const refreshedStatus = await invoke<FunAsrLocalStatus>('funasr_local_get_status');
      setStatus(refreshedStatus);
      if (refreshedStatus.is_ready) {
        await onModelSelect(refreshedStatus.model_name);
        toast.success(t('funasrLocalReady'));
      }
    } catch (error) {
      console.error('Failed to download FunASR local model:', error);
      toast.error(t('funasrLocalDownloadFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const addExistingModel = async () => {
    try {
      const modelName = await invoke<string | null>('funasr_local_add_existing_model');
      if (!modelName) return;
      await loadStatus();
      toast.success(t('existingModelAdded'), { description: modelName });
    } catch (error) {
      toast.error(t('existingModelAddFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const useLocalModel = async (modelName: string) => {
    try {
      await onModelSelect(modelName);
      toast.success(t('transcriptionSettingsSaved'));
    } catch (error) {
      console.error('Failed to select FunASR local model:', error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!status) {
    return <div className="h-36 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />;
  }

  if (!status.supported) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {t('funasrLocalUnsupported')}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start gap-3">
        <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-gray-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-gray-900">{t('funasrLocalModel')}</h3>
          <p className="mt-1 text-sm text-gray-600">{t('funasrLocalDescription')}</p>
          <p className="mt-2 text-xs text-gray-500">{t('funasrLocalDownloadDescription')}</p>

          {isDownloading ? (
            <div className="mt-4" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm text-gray-700">
                <span className="flex min-w-0 items-center gap-2"><Loader2 className="h-4 w-4 shrink-0 animate-spin" />{t('funasrLocalDownloading')}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : status.is_ready ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-emerald-700">{t('funasrLocalReady')}</span>
              <Button type="button" variant="outline" onClick={() => void useLocalModel(status.model_name)}>
                {t('funasrLocalUse')}
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={downloadModel}>
                <Download className="h-4 w-4" />
                {status.model_ready ? t('downloadRuntime') : t('funasrLocalDownload')}
              </Button>
              {!status.model_ready && (
                <Button type="button" variant="outline" onClick={() => void addExistingModel()}>
                  <Link2 className="h-4 w-4" />
                  {t('addExistingModel')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
