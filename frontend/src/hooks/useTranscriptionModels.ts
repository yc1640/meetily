import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

export interface RawModelInfo {
  name: string;
  size_mb: number;
  status: 'Available' | 'Missing' | { Downloading: { progress: number } } | { Error: string };
}

export type BatchTranscriptProvider =
  | 'localWhisper'
  | 'parakeet'
  | 'qwen3Asr'
  | 'funasrLocal'
  | 'funasr';

export interface ModelOption {
  provider: BatchTranscriptProvider;
  name: string;
  displayName: string;
  size_mb?: number;
}

interface TranscriptModelConfig {
  provider?: string;
  model?: string;
}

/**
 * Fetches every transcription provider supported by Settings and batch audio.
 *
 * This hook centralizes the model fetching logic that was previously duplicated
 * in ImportAudioDialog and RetranscribeDialog components.
 *
 * @param transcriptModelConfig - User's saved model configuration from context
 * @returns Object containing available models, selected model key, loading state, and fetch function
 */
export function useTranscriptionModels(transcriptModelConfig: TranscriptModelConfig | undefined) {
  const { t } = useAppLanguage();
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [loadingModels, setLoadingModels] = useState(false);
  // Track whether the user has manually changed the model selection
  const userSelectedRef = useRef(false);

  // Wrap setSelectedModelKey to track user-initiated changes
  const setSelectedModelKeyWithTracking = useCallback((key: string) => {
    userSelectedRef.current = true;
    setSelectedModelKey(key);
  }, []);

  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    const allModels: ModelOption[] = [];

    // Fetch Whisper models
    try {
      const whisperModels = await invoke<RawModelInfo[]>('whisper_get_available_models');
      const availableWhisper = whisperModels
        .filter((m) => m.status === 'Available')
        .map((m) => ({
          provider: 'localWhisper' as const,
          name: m.name,
          displayName: `🏠 ${t('localWhisper')}: ${m.name}`,
          size_mb: m.size_mb,
        }));
      allModels.push(...availableWhisper);
    } catch (err) {
      console.error('Failed to fetch Whisper models:', err);
    }

    // Fetch Parakeet models
    try {
      const parakeetModels = await invoke<RawModelInfo[]>('parakeet_get_available_models');
      const availableParakeet = parakeetModels
        .filter((m) => m.status === 'Available')
        .map((m) => ({
          provider: 'parakeet' as const,
          name: m.name,
          displayName: `⚡ ${t('parakeet')}: ${m.name}`,
          size_mb: m.size_mb,
        }));
      allModels.push(...availableParakeet);
    } catch (err) {
      console.error('Failed to fetch Parakeet models:', err);
    }

    // Fetch managed Qwen3-ASR models that already exist on this Mac.
    try {
      const status = await invoke<{
        runtime_ready: boolean;
        models: Array<{
          id: string;
          display_name: string;
          size_bytes: number;
          is_downloaded: boolean;
        }>;
      }>('qwen3_asr_get_status');
      allModels.push(
        ...status.models
          .filter((model) => model.is_downloaded)
          .map((model) => ({
            provider: 'qwen3Asr' as const,
            name: model.id,
            displayName: `💻 ${t('qwen3Asr')}: ${model.display_name}`,
            size_mb: model.size_bytes / 1024 / 1024,
          })),
      );
    } catch (err) {
      console.error('Failed to fetch Qwen3-ASR models:', err);
    }

    // Fetch the bundled local FunASR/SenseVoice model when it is ready.
    try {
      const status = await invoke<{
        is_ready: boolean;
        model_name: string;
        model_size_mb: number;
        runtime_size_mb: number;
      }>('funasr_local_get_status');
      if (status.is_ready) {
        allModels.push({
          provider: 'funasrLocal',
          name: status.model_name,
          displayName: `💻 ${t('funasrLocal')}: ${status.model_name}`,
          size_mb: status.model_size_mb + status.runtime_size_mb,
        });
      }
    } catch (err) {
      console.error('Failed to fetch local FunASR model:', err);
    }

    // The external FunASR endpoint/model is a saved service configuration,
    // rather than a downloadable model catalog.
    if (
      transcriptModelConfig?.provider === 'funasr' &&
      transcriptModelConfig.model?.trim()
    ) {
      allModels.push({
        provider: 'funasr',
        name: transcriptModelConfig.model,
        displayName: `🔗 ${t('funasr')}: ${transcriptModelConfig.model}`,
      });
    }

    // Set default model based on user's saved configuration
    const configuredProvider = transcriptModelConfig?.provider || '';
    const configuredModel = transcriptModelConfig?.model || '';

    let configuredMatch = allModels.find(
      (model) => model.provider === configuredProvider && model.name === configuredModel,
    );

    // Never silently replace the saved provider with another engine. Keeping a
    // missing configured model visible makes the eventual setup error explicit.
    const supportedProviders: BatchTranscriptProvider[] = [
      'localWhisper',
      'parakeet',
      'qwen3Asr',
      'funasrLocal',
      'funasr',
    ];
    if (
      !configuredMatch &&
      configuredModel &&
      supportedProviders.includes(configuredProvider as BatchTranscriptProvider)
    ) {
      const labels: Record<BatchTranscriptProvider, string> = {
        localWhisper: `🏠 ${t('localWhisper')}`,
        parakeet: `⚡ ${t('parakeet')}`,
        qwen3Asr: `💻 ${t('qwen3Asr')}`,
        funasrLocal: `💻 ${t('funasrLocal')}`,
        funasr: `🔗 ${t('funasr')}`,
      };
      configuredMatch = {
        provider: configuredProvider as BatchTranscriptProvider,
        name: configuredModel,
        displayName: `${labels[configuredProvider as BatchTranscriptProvider]}: ${configuredModel}`,
      };
      allModels.unshift(configuredMatch);
    }

    setAvailableModels(allModels);

    // Only set default model if user hasn't manually selected one
    if (!userSelectedRef.current) {
      if (configuredMatch) {
        // Use the configured model if available
        setSelectedModelKey(`${configuredMatch.provider}:${configuredMatch.name}`);
      } else if (allModels.length > 0) {
        // Fall back to first available model
        setSelectedModelKey(`${allModels[0].provider}:${allModels[0].name}`);
      }
    }

    setLoadingModels(false);
  }, [t, transcriptModelConfig]);

  // Reset user selection tracking (call when dialog opens fresh)
  const resetSelection = useCallback(() => {
    userSelectedRef.current = false;
  }, []);

  return {
    availableModels,
    selectedModelKey,
    setSelectedModelKey: setSelectedModelKeyWithTracking,
    loadingModels,
    fetchModels,
    resetSelection,
  };
}
