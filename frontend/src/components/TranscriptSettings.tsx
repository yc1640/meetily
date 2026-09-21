import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Eye, EyeOff, Server } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { FunAsrLocalModelManager } from './FunAsrLocalModelManager';
import { Qwen3AsrModelManager } from './Qwen3AsrModelManager';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

export type TranscriptProvider =
  | 'localWhisper'
  | 'parakeet'
  | 'qwen3Asr'
  | 'funasr'
  | 'funasrLocal'
  | 'deepgram'
  | 'elevenLabs'
  | 'groq'
  | 'openai';

export interface TranscriptModelProps {
  provider: TranscriptProvider;
  model: string;
  endpoint?: string | null;
  apiKey?: string | null;
}

export interface TranscriptSettingsProps {
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
  onModelSelect?: () => void;
}

const OPENAI_COMPATIBLE_DEFAULTS = {
  qwen3Asr: {
    endpoint: '',
    model: 'mlx-community/Qwen3-ASR-0.6B-8bit',
  },
  funasr: {
    endpoint: 'http://127.0.0.1:8000/v1',
    model: 'sensevoice',
  },
} as const;

function isOpenAiCompatibleProvider(provider: TranscriptProvider): provider is 'funasr' {
  return provider === 'funasr';
}

export function TranscriptSettings({
  transcriptModelConfig,
  setTranscriptModelConfig,
  onModelSelect,
}: TranscriptSettingsProps) {
  const { t } = useAppLanguage();
  const [uiProvider, setUiProvider] = useState<TranscriptProvider>(transcriptModelConfig.provider);
  const [endpoint, setEndpoint] = useState(transcriptModelConfig.endpoint ?? '');
  const [model, setModel] = useState(transcriptModelConfig.model);
  const [apiKey, setApiKey] = useState(transcriptModelConfig.apiKey ?? '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setUiProvider(transcriptModelConfig.provider);
    setEndpoint(transcriptModelConfig.endpoint ?? '');
    setModel(transcriptModelConfig.model);
    setApiKey(transcriptModelConfig.apiKey ?? '');
  }, [transcriptModelConfig]);

  const isOpenAiCompatible = isOpenAiCompatibleProvider(uiProvider);
  const providerLabel = useMemo(() => ({
    localWhisper: t('localWhisper'),
    parakeet: t('parakeet'),
    qwen3Asr: t('qwen3Asr'),
    funasr: t('funasr'),
    funasrLocal: t('funasrLocal'),
  }), [t]);

  const handleProviderChange = (provider: TranscriptProvider) => {
    setUiProvider(provider);
    if (provider === 'funasrLocal') {
      setEndpoint('');
      setModel('sensevoice-small-q8');
      setApiKey('');
      return;
    }
    if (provider === 'qwen3Asr') {
      setEndpoint('');
      setModel(OPENAI_COMPATIBLE_DEFAULTS.qwen3Asr.model);
      setApiKey('');
      return;
    }
    if (!isOpenAiCompatibleProvider(provider)) return;

    const defaults = OPENAI_COMPATIBLE_DEFAULTS[provider];
    setEndpoint(defaults.endpoint);
    setModel(defaults.model);
    setApiKey('');
  };

  const handleWhisperModelSelect = (modelName: string) => {
    setTranscriptModelConfig({
      provider: 'localWhisper',
      model: modelName,
      endpoint: null,
      apiKey: null,
    });
    onModelSelect?.();
  };

  const handleParakeetModelSelect = (modelName: string) => {
    setTranscriptModelConfig({
      provider: 'parakeet',
      model: modelName,
      endpoint: null,
      apiKey: null,
    });
    onModelSelect?.();
  };

  const handleFunAsrLocalModelSelect = async (modelName: string) => {
    const config: TranscriptModelProps = {
      provider: 'funasrLocal',
      model: modelName,
      endpoint: null,
      apiKey: null,
    };
    await invoke('api_save_transcript_config', {
      provider: config.provider,
      model: config.model,
      endpoint: null,
      apiKey: null,
    });
    setTranscriptModelConfig(config);
    onModelSelect?.();
  };

  const handleQwen3AsrModelSelect = async (modelName: string) => {
    const config: TranscriptModelProps = {
      provider: 'qwen3Asr',
      model: modelName,
      endpoint: null,
      apiKey: null,
    };
    await invoke('api_save_transcript_config', {
      provider: config.provider,
      model: config.model,
      endpoint: null,
      apiKey: null,
    });
    setTranscriptModelConfig(config);
    onModelSelect?.();
  };

  const saveOpenAiCompatibleConfig = async () => {
    const trimmedEndpoint = endpoint.trim();
    const trimmedModel = model.trim();
    if (!trimmedEndpoint || !trimmedModel) {
      toast.error(t('setupRequired'));
      return;
    }

    setIsSaving(true);
    try {
      const config: TranscriptModelProps = {
        provider: 'funasr',
        endpoint: trimmedEndpoint,
        model: trimmedModel,
        apiKey: apiKey.trim() || null,
      };
      await invoke('api_save_transcript_config', {
        provider: config.provider,
        endpoint: config.endpoint,
        model: config.model,
        apiKey: config.apiKey,
      });
      setTranscriptModelConfig(config);
      toast.success(t('transcriptionSettingsSaved'));
    } catch (error) {
      console.error('Failed to save transcription settings:', error);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6 pb-6">
      <div className="space-y-2">
        <Label htmlFor="transcript-provider" className="block text-sm font-medium text-gray-700">
          {t('transcriptModel')}
        </Label>
        <Select value={uiProvider} onValueChange={(value) => handleProviderChange(value as TranscriptProvider)}>
          <SelectTrigger id="transcript-provider" className="focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
            <SelectValue placeholder={t('selectProvider')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t('inAppAsrModels')}</SelectLabel>
              <SelectItem value="parakeet">{providerLabel.parakeet}</SelectItem>
              <SelectItem value="localWhisper">{providerLabel.localWhisper}</SelectItem>
              <SelectItem value="funasrLocal">{providerLabel.funasrLocal}</SelectItem>
              <SelectItem value="qwen3Asr">{providerLabel.qwen3Asr}</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t('externalAsrServices')}</SelectLabel>
              <SelectItem value="funasr">{providerLabel.funasr}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-sm text-gray-600">
          {isOpenAiCompatible ? t('externalAsrSelectionHint') : t('inAppAsrSelectionHint')}
        </p>
      </div>

      {uiProvider === 'localWhisper' && (
        <ModelManager
          selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined}
          onModelSelect={handleWhisperModelSelect}
          autoSave
        />
      )}

      {uiProvider === 'parakeet' && (
        <ParakeetModelManager
          selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined}
          onModelSelect={handleParakeetModelSelect}
          autoSave
        />
      )}

      {uiProvider === 'funasrLocal' && (
        <FunAsrLocalModelManager onModelSelect={handleFunAsrLocalModelSelect} />
      )}

      {uiProvider === 'qwen3Asr' && (
        <Qwen3AsrModelManager
          selectedModel={transcriptModelConfig.provider === 'qwen3Asr' ? transcriptModelConfig.model : undefined}
          onModelSelect={handleQwen3AsrModelSelect}
        />
      )}

      {isOpenAiCompatible && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            <Server className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{t('externalAsrServiceNotice')}</p>
          </div>
          <div>
            <Label htmlFor="transcript-endpoint">{t('endpoint')}</Label>
            <p className="mt-1 text-sm text-gray-600">{t('endpointDescription')}</p>
            <Input
              id="transcript-endpoint"
              className="mt-2 bg-white"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://127.0.0.1:8000/v1"
              inputMode="url"
            />
          </div>
          <div>
            <Label htmlFor="transcript-model">{t('modelName')}</Label>
            <Input
              id="transcript-model"
              className="mt-2 bg-white"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="transcript-api-key">{t('apiKey')}</Label>
            <p className="mt-1 text-sm text-gray-600">{t('apiKeyOptional')}</p>
            <div className="relative mt-2">
              <Input
                id="transcript-api-key"
                className="bg-white pr-10"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute inset-y-0 right-0"
                aria-label={showApiKey ? t('hideApiKey') : t('showApiKey')}
                onClick={() => setShowApiKey((visible) => !visible)}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <Button onClick={saveOpenAiCompatibleConfig} disabled={isSaving}>
            {isSaving ? `${t('saveTranscriptionSettings')}…` : t('saveTranscriptionSettings')}
          </Button>
        </div>
      )}
    </div>
  );
}
