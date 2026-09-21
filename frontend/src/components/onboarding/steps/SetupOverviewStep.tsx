import React, { useEffect, useState } from 'react';
import { Check, Info, Mic, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getSummaryModelSizeLabel } from '@/lib/onboarding-summary-model';
import { useAppLanguage } from '@/contexts/AppLanguageContext';

const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

export function SetupOverviewStep() {
  const {
    goNext,
    parakeetDownloaded,
    summaryModelDownloaded,
    selectedSummaryModel,
    recommendedSummaryModel,
    downloadTranscriptionDuringSetup,
    downloadSummaryDuringSetup,
    setDownloadTranscriptionDuringSetup,
    setDownloadSummaryDuringSetup,
  } = useOnboarding();
  const { t } = useAppLanguage();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setIsMac(platform() === 'macos');
      } catch {
        setIsMac(navigator.userAgent.includes('Mac'));
      }
    };
    void checkPlatform();
  }, []);

  const summaryModel = selectedSummaryModel || recommendedSummaryModel;
  const modelRows = [
    {
      key: 'transcription',
      icon: Mic,
      title: t('transcriptionEngine'),
      model: `Parakeet · ${PARAKEET_MODEL}`,
      size: '~670 MB',
      downloaded: parakeetDownloaded,
      enabled: downloadTranscriptionDuringSetup,
      setEnabled: setDownloadTranscriptionDuringSetup,
    },
    {
      key: 'summary',
      icon: Sparkles,
      title: t('summaryEngine'),
      model: summaryModel || t('detectingRecommendedModel'),
      size: summaryModel ? getSummaryModelSizeLabel(summaryModel) : '—',
      downloaded: summaryModelDownloaded,
      enabled: downloadSummaryDuringSetup,
      setEnabled: setDownloadSummaryDuringSetup,
    },
  ];

  return (
    <OnboardingContainer
      title={t('chooseSetupModels')}
      description={t('chooseSetupModelsDescription')}
      step={2}
      totalSteps={isMac ? 4 : 3}
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {modelRows.map((row, index) => {
            const Icon = row.icon;
            return (
              <div
                key={row.key}
                className={`flex items-center gap-4 p-5 ${index > 0 ? 'border-t border-gray-200' : ''}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
                  <Icon className="h-5 w-5 text-gray-600" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-gray-900">{row.title}</h3>
                    {row.key === 'summary' && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-gray-400 transition-colors hover:text-gray-600"
                              aria-label={t('summaryModelHelp')}
                            >
                              <Info className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-sm">
                            {t('externalSummaryProviders')}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <p className="mt-1 break-words text-sm text-gray-600">{row.model}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{row.size}</p>
                </div>
                {row.downloaded ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-emerald-700">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {t('downloaded')}
                  </span>
                ) : (
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Switch
                      checked={row.enabled}
                      onCheckedChange={row.setEnabled}
                      aria-label={`${row.title}：${t('downloadNow')}`}
                    />
                    <span className="text-xs text-gray-600">
                      {row.enabled ? t('downloadNow') : t('setUpLater')}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center text-sm leading-6 text-gray-600">
          {t('modelsCanBeManagedLater')}
        </p>

        <div className="mx-auto w-full max-w-xs space-y-4">
          <Button
            onClick={goNext}
            className="h-11 w-full bg-gray-900 text-white hover:bg-gray-800"
          >
            {t('continue')}
          </Button>
          <div className="text-center">
            <a
              href="https://github.com/Zackriya-Solutions/meeting-minutes"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:underline"
            >
              {t('reportIssues')}
            </a>
          </div>
        </div>
      </div>
    </OnboardingContainer>
  );
}
