import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle2, Download, HardDrive, Link2, Loader2, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

interface Qwen3AsrModelStatus {
  id: string;
  display_name: string;
  size_bytes: number;
  is_downloaded: boolean;
}

interface Qwen3AsrLocalStatus {
  supported: boolean;
  runtime_ready: boolean;
  is_downloading: boolean;
  download_model_id: string | null;
  download_stage: DownloadProgress['stage'];
  download_progress: number;
  service_running: boolean;
  models: Qwen3AsrModelStatus[];
}

interface DownloadProgress {
  model_id: string;
  stage: 'runtime_download' | 'python' | 'mlx_audio' | 'runtime_ready' | 'model';
  progress: number;
}

interface Qwen3AsrModelManagerProps {
  selectedModel?: string;
  onModelSelect: (modelId: string) => Promise<void>;
}

function formatSize(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024;
  return gib >= 1 ? `${gib.toFixed(2)} GiB` : `${Math.round(bytes / 1024 / 1024)} MiB`;
}

export function Qwen3AsrModelManager({
  selectedModel,
  onModelSelect,
}: Qwen3AsrModelManagerProps) {
  const { t } = useAppLanguage();
  const [status, setStatus] = useState<Qwen3AsrLocalStatus | null>(null);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<DownloadProgress['stage']>('runtime_download');

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await invoke<Qwen3AsrLocalStatus>('qwen3_asr_get_status');
      setStatus(nextStatus);
      if (nextStatus.is_downloading && nextStatus.download_model_id) {
        setDownloadingModel(nextStatus.download_model_id);
        setStage(nextStatus.download_stage);
        setProgress(nextStatus.download_progress);
      }
    } catch (error) {
      console.error('Failed to load managed Qwen3-ASR status:', error);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const registerListeners = async () => {
      unlistenProgress = await listen<DownloadProgress>('qwen3-asr-download-progress', (event) => {
        setDownloadingModel(event.payload.model_id);
        setProgress(event.payload.progress);
        setStage(event.payload.stage);
      });
      unlistenComplete = await listen<{ model_id: string }>('qwen3-asr-download-complete', () => {
        setDownloadingModel(null);
        setProgress(100);
        void loadStatus();
      });
      unlistenError = await listen('qwen3-asr-download-error', () => {
        setDownloadingModel(null);
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

  const downloadModel = async (model: Qwen3AsrModelStatus) => {
    setDownloadingModel(model.id);
    setProgress(0);
    setStage('runtime_download');
    try {
      await invoke('qwen3_asr_download_model', { modelId: model.id });
      await loadStatus();
      await onModelSelect(model.id);
      toast.success(t('qwen3AsrReady'), { description: model.display_name });
    } catch (error) {
      console.error('Failed to prepare managed Qwen3-ASR:', error);
      toast.error(t('qwen3AsrDownloadFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDownloadingModel(null);
    }
  };

  const addExistingModel = async () => {
    try {
      const modelId = await invoke<string | null>('qwen3_asr_add_existing_model');
      if (!modelId) return;
      await loadStatus();
      await onModelSelect(modelId);
      toast.success(t('existingModelAdded'), { description: modelId });
    } catch (error) {
      toast.error(t('existingModelAddFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const useModel = async (model: Qwen3AsrModelStatus) => {
    try {
      await onModelSelect(model.id);
      toast.success(t('transcriptionSettingsSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const stageLabel = {
    runtime_download: t('qwen3AsrStageRuntimeDownload'),
    python: t('qwen3AsrStagePython'),
    mlx_audio: t('qwen3AsrStageMlxAudio'),
    runtime_ready: t('qwen3AsrStageRuntimeReady'),
    model: t('qwen3AsrStageModel'),
  }[stage];

  if (!status) {
    return <div className="h-52 animate-pulse rounded-lg border border-gray-200 bg-gray-50" />;
  }

  if (!status.supported) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {t('qwen3AsrUnsupported')}
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start gap-3">
        <Server className="mt-0.5 h-5 w-5 shrink-0 text-gray-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-gray-900">{t('qwen3AsrLocalTitle')}</h3>
          <p className="mt-1 text-sm text-gray-600">{t('qwen3AsrLocalDescription')}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{status.runtime_ready ? t('qwen3AsrRuntimeReady') : t('qwen3AsrRuntimeMissing')}</span>
            {status.service_running && <span className="text-emerald-700">{t('qwen3AsrServiceRunning')}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {status.models.map((model) => {
          const isDownloading = downloadingModel === model.id;
          const isSelected = selectedModel === model.id;
          const canUse = model.is_downloaded && status.runtime_ready;
          return (
            <div key={model.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
                    <p className="font-medium text-gray-900">{model.display_name}</p>
                    {isSelected && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{t('selected')}</span>}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{formatSize(model.size_bytes)}</p>
                </div>

                {!isDownloading && (
                  canUse ? (
                    <Button type="button" variant="outline" onClick={() => void useModel(model)}>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {isSelected ? t('ready') : t('qwen3AsrUse')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => void downloadModel(model)}
                      disabled={downloadingModel !== null}
                    >
                      <Download className="h-4 w-4" />
                      {model.is_downloaded ? t('qwen3AsrPrepareRuntime') : t('download')}
                    </Button>
                  )
                )}
              </div>

              {isDownloading && (
                <div className="mt-3" aria-live="polite">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm text-gray-700">
                    <span className="flex min-w-0 items-center gap-2">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      {stageLabel}
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
        <p className="text-xs text-gray-500">{t('qwen3AsrExistingModelHint')}</p>
        <Button type="button" variant="outline" onClick={() => void addExistingModel()} disabled={downloadingModel !== null}>
          <Link2 className="h-4 w-4" />
          {t('addExistingModel')}
        </Button>
      </div>
    </section>
  );
}
