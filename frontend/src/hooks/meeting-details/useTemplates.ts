import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { TranslationKey, useAppLanguage } from '@/contexts/AppLanguageContext';

export interface SummaryTemplateInfo {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  isCustomized: boolean;
}

interface BuiltInTemplateTranslation {
  originalName: string;
  originalDescription: string;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
}

const BUILT_IN_TEMPLATE_TRANSLATIONS: Record<string, BuiltInTemplateTranslation> = {
  content_summary: {
    originalName: 'Content Summary',
    originalDescription: 'Turn a video, podcast, lecture, interview, or narration transcript into a structured content brief.',
    nameKey: 'templateContentSummaryName',
    descriptionKey: 'templateContentSummaryDescription',
  },
  project_sync: {
    originalName: 'Project Progress',
    originalDescription: 'Track progress, milestones, decisions, risks, dependencies, and next steps for a project.',
    nameKey: 'templateProjectSyncName',
    descriptionKey: 'templateProjectSyncDescription',
  },
  standard_meeting: {
    originalName: 'General Meeting Notes',
    originalDescription: 'A practical record for general meetings, preserving discussion context, decisions, actions, and open questions.',
    nameKey: 'templateStandardMeetingName',
    descriptionKey: 'templateStandardMeetingDescription',
  },
};

export function useTemplates() {
  const { t } = useAppLanguage();
  const [rawTemplates, setRawTemplates] = useState<SummaryTemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard_meeting');

  const availableTemplates = useMemo(() => rawTemplates.map((template) => {
    const translation = BUILT_IN_TEMPLATE_TRANSLATIONS[template.id];
    if (!translation) return template;

    return {
      ...template,
      name: template.name === translation.originalName ? t(translation.nameKey) : template.name,
      description: template.description === translation.originalDescription
        ? t(translation.descriptionKey)
        : template.description,
    };
  }), [rawTemplates, t]);

  const refreshTemplates = useCallback(async () => {
    try {
      const templates = await invokeTauri('api_list_templates') as SummaryTemplateInfo[];
      console.log('Available templates:', templates);
      setRawTemplates(templates);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      throw error;
    }
  }, []);

  // Fetch available templates on mount
  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success(t('templateSelected'), {
      description: t('usingTemplateForSummary').replace('{name}', templateName),
    });
    Analytics.trackFeatureUsed('template_selected');
  }, [t]);

  return {
    availableTemplates,
    selectedTemplate,
    handleTemplateSelection,
    refreshTemplates,
  };
}
