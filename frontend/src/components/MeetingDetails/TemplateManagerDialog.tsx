"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { useAppLanguage } from '@/contexts/AppLanguageContext';
import { SummaryTemplateInfo } from '@/hooks/meeting-details/useTemplates';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type TemplateSectionFormat = 'paragraph' | 'list' | 'string';

interface TemplateSection {
  title: string;
  instruction: string;
  format: TemplateSectionFormat;
  item_format?: string;
  example_item_format?: string;
}

interface TemplateDefinition {
  name: string;
  description: string;
  prompt?: string;
  sections: TemplateSection[];
}

interface EditableTemplateDetails {
  id: string;
  template: TemplateDefinition;
  isBuiltIn: boolean;
  isCustomized: boolean;
}

const BUILT_IN_TEMPLATES_ZH_CN: Record<string, TemplateDefinition> = {
  standard_meeting: {
    name: '通用会议纪要',
    description: '适用于一般会议，保留讨论背景、决策、行动事项与未决问题。',
    prompt: '为未参会者生成一份可以独立阅读的会议记录。明确区分讨论过的主题、提出的建议和已经确认的决定。根据所选详细程度，保留重要背景、推理、分歧、承诺、负责人、日期、风险和未决问题。合并重复内容，去除寒暄和填充内容。只能依据转写原文，不得编造参会者、共识、负责人、日期或确定性。重要决定或承诺需要核对时，应保留原文时间戳。',
    sections: [
      {
        title: '会议概览',
        instruction: '简要说明会议目的、明确出现且确有必要的参会者或角色、主要议题和最重要的结果，使未查看转写的人也能理解。不要把仅被提到的人误认为参会者',
        format: 'paragraph',
      },
      {
        title: '议题与讨论',
        instruction: '按主题组织实质讨论，说明必要背景、主要观点和有实质差异的意见。不要把建议或尚无结论的讨论写成决定',
        format: 'paragraph',
      },
      {
        title: '已确认决策',
        instruction: '只记录明确确认的决定；原文提及时，保留决定依据、适用条件、负责人和时间戳',
        format: 'list',
        item_format: '| 决策 | 依据 / 条件 | 负责人 | 原文位置 |\n| --- | --- | --- | --- |',
      },
      {
        title: '行动事项',
        instruction: '记录所有明确的后续承诺。负责人或截止时间没有说明时应明确标为未说明，不得猜测；原文提及时保留依赖关系或完成标准',
        format: 'list',
        item_format: '| 行动事项 | 负责人 | 截止时间 | 依赖 / 完成标准 | 原文位置 |\n| --- | --- | --- | --- | --- |',
      },
      {
        title: '风险与未决问题',
        instruction: '列出重要风险、阻塞、分歧和仍待解决的问题；原文提及时注明需要谁处理或确认，以及下一步',
        format: 'list',
        item_format: '| 类型 | 事项 | 影响 | 负责人 / 需谁确认 | 下一步 |\n| --- | --- | --- | --- | --- |',
      },
    ],
  },
  project_sync: {
    name: '项目进展同步',
    description: '整理项目进展、里程碑、决策、风险、依赖关系与下一步计划。',
    prompt: '生成一份项目状态记录，帮助团队了解发生了什么变化、哪些工作进展正常或存在风险，以及下一步必须完成什么。按工作流或交付物组织更新，不要按发言人机械罗列。区分已完成、进行中、提议中，以及已经确认的范围或排期变更。根据所选详细程度保留指标、里程碑、依赖、决策依据、负责人、截止时间和明确的状态信号。原文没有说明时，不得推断进度、优先级、负责人、日期或项目健康状态。',
    sections: [
      {
        title: '总体状态',
        instruction: '概括项目当前状态、相较上次最重要的变化和近期重点。只有原文明确定义健康度或排期状态时才记录，否则不要自行给出状态',
        format: 'paragraph',
      },
      {
        title: '进展与里程碑',
        instruction: '按工作流记录重要进展、已完成工作、进行中工作、里程碑变化和可量化结果。状态、负责人或预计时间未说明时应明确标为未说明，不得猜测',
        format: 'list',
        item_format: '| 工作流 / 里程碑 | 进展或变化 | 状态 | 负责人 | 预计时间 |\n| --- | --- | --- | --- | --- |',
      },
      {
        title: '风险、阻塞与依赖',
        instruction: '记录风险、当前阻塞，以及跨团队或外部依赖。原文提及时保留影响、缓解措施、依赖方向、负责人和升级需求',
        format: 'list',
        item_format: '| 类型 | 事项 | 影响 | 负责人 | 缓解措施 / 所需支持 |\n| --- | --- | --- | --- | --- |',
      },
      {
        title: '决策与变更',
        instruction: '记录已确认的决定，以及范围、优先级、负责人或排期变更。与提议明确区分，并在原文提及时保留依据、条件和时间戳',
        format: 'list',
        item_format: '| 决策 / 变更 | 依据 / 条件 | 负责人 | 原文位置 |\n| --- | --- | --- | --- |',
      },
      {
        title: '下一步',
        instruction: '记录明确的任务和后续承诺；原文提及时保留负责人、日期、依赖和完成标志',
        format: 'list',
        item_format: '| 行动事项 | 负责人 | 截止时间 | 依赖 / 完成标志 |\n| --- | --- | --- | --- |',
      },
      {
        title: '待确认问题',
        instruction: '列出尚未解决的问题、待定决策和缺失信息，并注明需要谁回答或需要什么证据',
        format: 'list',
        item_format: '| 问题 | 需谁确认 | 下一步 / 决策点 |\n| --- | --- | --- |',
      },
    ],
  },
  content_summary: {
    name: '内容总结',
    description: '将视频、播客、课程、访谈或解说转写整理为结构化内容摘要。',
    prompt: '为没有看过或听过原内容的人生成一份可以独立阅读的内容摘要。根据所选详细程度，保留核心主题、推理、证据、示例、术语、限定条件、结论和有意义的观点变化。区分来源明确主张的内容与示例、推测或尚未回答的问题。去除寒暄、赞助信息、重复表达、填充内容和行动号召，除非它们本身属于实质内容。不要把来源描述成会议，不要直接对用户说话，也不要反问应如何处理转写。',
    sections: [
      {
        title: '内容概览',
        instruction: '简要说明来源在讲什么、为什么重要、目的是什么，以及主要结论或核心启示',
        format: 'paragraph',
      },
      {
        title: '核心观点',
        instruction: '按清晰的逻辑顺序呈现最重要的主张、解释、方法、事件或经验。保留因果关系，并区分来源自身立场与引用或反方观点',
        format: 'list',
      },
      {
        title: '证据与重要细节',
        instruction: '记录理解和判断核心观点所需的具体示例、证据、机制、对比、数字、名称、定义或限定条件',
        format: 'list',
      },
      {
        title: '可实践启示',
        instruction: '列出读者可以应用的方法、建议、经验或影响。描述性内容应保持描述性；来源没有提出建议时，不要自行制造建议',
        format: 'list',
      },
      {
        title: '结论与开放问题',
        instruction: '概括来源的结论、保留意见、未解决问题或希望读者获得的核心启示，不加入外部观点',
        format: 'list',
      },
      {
        title: '关键词',
        instruction: '列出 5 至 12 个便于搜索和分类的准确关键词或命名概念',
        format: 'list',
      },
    ],
  },
};

interface TemplateManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: SummaryTemplateInfo[];
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  onTemplatesChanged: () => Promise<void>;
}

function cloneTemplate(template: TemplateDefinition): TemplateDefinition {
  return {
    ...template,
    sections: template.sections.map((section) => ({ ...section })),
  };
}

function templateForDisplay(
  details: EditableTemplateDetails,
  appLanguage: 'en' | 'zh-CN',
): TemplateDefinition {
  if (appLanguage === 'zh-CN' && details.isBuiltIn && !details.isCustomized) {
    return cloneTemplate(BUILT_IN_TEMPLATES_ZH_CN[details.id] ?? details.template);
  }
  return cloneTemplate(details.template);
}

export function TemplateManagerDialog({
  open,
  onOpenChange,
  templates,
  selectedTemplate,
  onTemplateSelect,
  onTemplatesChanged,
}: TemplateManagerDialogProps) {
  const { appLanguage, t } = useAppLanguage();
  const [details, setDetails] = useState<EditableTemplateDetails | null>(null);
  const [draft, setDraft] = useState<TemplateDefinition | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInitializedOpen, setHasInitializedOpen] = useState(false);

  const isDirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== savedSnapshot,
    [draft, savedSnapshot],
  );

  const loadTemplate = useCallback(async (templateId: string) => {
    setIsLoading(true);
    setError(null);
    setDeleteArmed(false);
    try {
      const result = await invoke<EditableTemplateDetails>('api_get_template_for_editing', {
        templateId,
      });
      const nextDraft = templateForDisplay(result, appLanguage);
      setDetails(result);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(nextDraft));
      setIsNew(false);
    } catch (loadError) {
      console.error('Failed to load summary template:', loadError);
      setError(`${t('templateLoadFailed')}: ${String(loadError)}`);
    } finally {
      setIsLoading(false);
    }
  }, [appLanguage, t]);

  useEffect(() => {
    if (!open) {
      setHasInitializedOpen(false);
      return;
    }
    if (hasInitializedOpen) return;
    setHasInitializedOpen(true);
    const initialId = templates.some((template) => template.id === selectedTemplate)
      ? selectedTemplate
      : templates[0]?.id;
    if (initialId) void loadTemplate(initialId);
  }, [hasInitializedOpen, loadTemplate, open, selectedTemplate, templates]);

  const confirmDiscard = useCallback(() => (
    !isDirty || window.confirm(t('discardTemplateChanges'))
  ), [isDirty, t]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !confirmDiscard()) return;
    if (!nextOpen) {
      setDetails(null);
      setDraft(null);
      setSavedSnapshot('');
      setIsNew(false);
      setError(null);
      setDeleteArmed(false);
    }
    onOpenChange(nextOpen);
  };

  const handleChooseTemplate = (templateId: string) => {
    if (details?.id === templateId && !isNew) return;
    if (!confirmDiscard()) return;
    setDraft(null);
    setSavedSnapshot('');
    void loadTemplate(templateId);
  };

  const handleCreateTemplate = () => {
    if (!confirmDiscard()) return;
    const nextDraft: TemplateDefinition = {
      name: t('defaultCustomTemplateName'),
      description: t('defaultCustomTemplateDescription'),
      prompt: t('defaultCustomTemplatePrompt'),
      sections: [{
        title: t('defaultCustomSectionTitle'),
        instruction: t('defaultCustomSectionInstruction'),
        format: 'paragraph',
      }],
    };
    setDetails(null);
    setDraft(nextDraft);
    setSavedSnapshot('');
    setIsNew(true);
    setError(null);
    setDeleteArmed(false);
  };

  const updateDraft = (patch: Partial<TemplateDefinition>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setDeleteArmed(false);
  };

  const updateSection = (index: number, patch: Partial<TemplateSection>) => {
    setDraft((current) => {
      if (!current) return current;
      const sections = current.sections.map((section, sectionIndex) => (
        sectionIndex === index ? { ...section, ...patch } : section
      ));
      return { ...current, sections };
    });
    setDeleteArmed(false);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.sections.length) return current;
      const sections = [...current.sections];
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, sections };
    });
  };

  const addSection = () => {
    setDraft((current) => current ? {
      ...current,
      sections: [
        ...current.sections,
        {
          title: t('defaultCustomSectionTitle'),
          instruction: t('defaultCustomSectionInstruction'),
          format: 'paragraph',
        },
      ],
    } : current);
  };

  const removeSection = (index: number) => {
    setDraft((current) => {
      if (!current || current.sections.length <= 1) return current;
      return {
        ...current,
        sections: current.sections.filter((_, sectionIndex) => sectionIndex !== index),
      };
    });
  };

  const normalizedDraft = (): TemplateDefinition | null => {
    if (!draft) return null;
    const name = draft.name.trim();
    const description = draft.description.trim();
    const sections = draft.sections.map((section) => {
      const itemFormat = section.item_format?.trim() || section.example_item_format?.trim();
      return {
        title: section.title.trim(),
        instruction: section.instruction.trim(),
        format: section.format,
        ...(section.format === 'list' && itemFormat ? { item_format: itemFormat } : {}),
      };
    });

    if (!name || !description || sections.length === 0
      || sections.some((section) => !section.title || !section.instruction)) {
      return null;
    }

    const prompt = draft.prompt?.trim();
    return {
      name,
      description,
      ...(prompt ? { prompt } : {}),
      sections,
    };
  };

  const handleSave = async () => {
    const template = normalizedDraft();
    if (!template) {
      setError(t('templateRequiredFields'));
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const saved = await invoke<SummaryTemplateInfo>('api_save_template', {
        templateId: isNew ? null : details?.id,
        template,
      });
      await onTemplatesChanged();
      await loadTemplate(saved.id);
      toast.success(t('templateSaved'));
    } catch (saveError) {
      console.error('Failed to save summary template:', saveError);
      setError(`${t('templateSaveFailed')}: ${String(saveError)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteOrRestore = async () => {
    if (!details?.isCustomized) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }

    setIsDeleting(true);
    setError(null);
    const wasBuiltIn = details.isBuiltIn;
    const deletedId = details.id;
    try {
      await invoke('api_delete_custom_template', { templateId: deletedId });
      await onTemplatesChanged();

      if (wasBuiltIn) {
        await loadTemplate(deletedId);
        toast.success(t('templateRestored'));
      } else {
        const fallback = templates.find((template) => template.id === 'standard_meeting')
          ?? templates.find((template) => template.id !== deletedId);
        setDetails(null);
        setDraft(null);
        setSavedSnapshot('');
        if (fallback) {
          if (selectedTemplate === deletedId) {
            onTemplateSelect(fallback.id, fallback.name);
          }
          await loadTemplate(fallback.id);
        }
        toast.success(t('templateDeleted'));
      }
    } catch (deleteError) {
      console.error('Failed to delete summary template:', deleteError);
      setError(`${wasBuiltIn ? t('templateRestoreFailed') : t('templateDeleteFailed')}: ${String(deleteError)}`);
    } finally {
      setIsDeleting(false);
      setDeleteArmed(false);
    }
  };

  const handleUseTemplate = () => {
    if (!details || isDirty) return;
    const displayName = templates.find((template) => template.id === details.id)?.name
      ?? details.template.name;
    onTemplateSelect(details.id, displayName);
    handleOpenChange(false);
  };

  const templateStatus = (template: SummaryTemplateInfo) => {
    if (template.isBuiltIn && template.isCustomized) return t('templateModified');
    return template.isBuiltIn ? t('templateBuiltIn') : t('templateCustom');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100vh-2rem))] max-w-[980px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-gray-200 px-6 py-5 pr-12">
          <DialogTitle className="text-xl">{t('templateManagerTitle')}</DialogTitle>
          <DialogDescription>{t('templateManagerDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-gray-200 bg-gray-50 md:border-b-0 md:border-r">
            <div className="p-3">
              <Button className="w-full justify-start" variant="outline" onClick={handleCreateTemplate}>
                <Plus className="mr-2 h-4 w-4" />
                {t('newCustomTemplate')}
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
              <div className="space-y-1">
                {templates.map((template) => {
                  const isEditing = details?.id === template.id && !isNew;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleChooseTemplate(template.id)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        isEditing ? 'bg-white shadow-sm ring-1 ring-gray-200' : 'hover:bg-gray-100'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium leading-5 text-gray-900">
                          {template.name}
                        </span>
                        {selectedTemplate === template.id && (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-label={t('templateInUse')} />
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-4 text-gray-500">
                        {templateStatus(template)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col bg-white">
            {isLoading || !draft ? (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('loadingTemplate')}
              </div>
            ) : (
              <>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="mx-auto max-w-3xl space-y-7 p-6">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="template-name">{t('templateNameLabel')}</Label>
                        <Input
                          id="template-name"
                          maxLength={80}
                          value={draft.name}
                          placeholder={t('templateNamePlaceholder')}
                          onChange={(event) => updateDraft({ name: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="template-description">{t('templateDescriptionLabel')}</Label>
                        <Textarea
                          id="template-description"
                          maxLength={500}
                          className="min-h-[72px] resize-y"
                          value={draft.description}
                          placeholder={t('templateDescriptionPlaceholder')}
                          onChange={(event) => updateDraft({ description: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="template-prompt">{t('templatePromptLabel')}</Label>
                      <Textarea
                        id="template-prompt"
                        maxLength={20000}
                        className="min-h-[120px] resize-y leading-6"
                        value={draft.prompt ?? ''}
                        placeholder={t('templatePromptPlaceholder')}
                        onChange={(event) => updateDraft({ prompt: event.target.value })}
                      />
                      <p className="text-xs leading-5 text-gray-500">{t('templatePromptHelp')}</p>
                    </div>

                    <Alert className="bg-blue-50/60 text-blue-950">
                      <Info className="h-4 w-4" />
                      <AlertTitle>{t('fixedSummaryRulesTitle')}</AlertTitle>
                      <AlertDescription className="text-blue-900/80">
                        {t('fixedSummaryRulesDescription')}
                      </AlertDescription>
                    </Alert>

                    <section className="space-y-4">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <h3 className="text-base font-semibold text-gray-950">{t('templateSectionsTitle')}</h3>
                          <p className="mt-1 text-sm leading-5 text-gray-500">{t('templateSectionsDescription')}</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addSection}
                          disabled={draft.sections.length >= 20}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          {t('addTemplateSection')}
                        </Button>
                      </div>

                      <div className="space-y-3">
                        {draft.sections.map((section, index) => (
                          <div key={index} className="rounded-xl border border-gray-200 p-4">
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-gray-800">
                                {t('templateSectionLabel')} {index + 1}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  disabled={index === 0}
                                  title={t('moveSectionUp')}
                                  aria-label={t('moveSectionUp')}
                                  onClick={() => moveSection(index, -1)}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  disabled={index === draft.sections.length - 1}
                                  title={t('moveSectionDown')}
                                  aria-label={t('moveSectionDown')}
                                  onClick={() => moveSection(index, 1)}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                                  disabled={draft.sections.length <= 1}
                                  title={t('removeTemplateSection')}
                                  aria-label={t('removeTemplateSection')}
                                  onClick={() => removeSection(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                              <div className="space-y-2">
                                <Label htmlFor={`section-title-${index}`}>{t('sectionTitleLabel')}</Label>
                                <Input
                                  id={`section-title-${index}`}
                                  maxLength={120}
                                  value={section.title}
                                  placeholder={t('sectionTitlePlaceholder')}
                                  onChange={(event) => updateSection(index, { title: event.target.value })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>{t('sectionFormatLabel')}</Label>
                                <Select
                                  value={section.format}
                                  onValueChange={(value: TemplateSectionFormat) => updateSection(index, { format: value })}
                                >
                                  <SelectTrigger aria-label={t('sectionFormatLabel')}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="paragraph">{t('formatParagraph')}</SelectItem>
                                    <SelectItem value="list">{t('formatList')}</SelectItem>
                                    <SelectItem value="string">{t('formatSingleValue')}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <div className="mt-4 space-y-2">
                              <Label htmlFor={`section-instruction-${index}`}>{t('sectionInstructionLabel')}</Label>
                              <Textarea
                                id={`section-instruction-${index}`}
                                maxLength={4000}
                                className="min-h-[84px] resize-y leading-5"
                                value={section.instruction}
                                placeholder={t('sectionInstructionPlaceholder')}
                                onChange={(event) => updateSection(index, { instruction: event.target.value })}
                              />
                            </div>

                            {section.format === 'list' && (
                              <div className="mt-4 space-y-2">
                                <Label htmlFor={`section-list-format-${index}`}>{t('sectionListFormatLabel')}</Label>
                                <Textarea
                                  id={`section-list-format-${index}`}
                                  className="min-h-[64px] resize-y font-mono text-xs leading-5"
                                  value={section.item_format ?? section.example_item_format ?? ''}
                                  placeholder={t('sectionListFormatPlaceholder')}
                                  onChange={(event) => updateSection(index, {
                                    item_format: event.target.value,
                                    example_item_format: undefined,
                                  })}
                                />
                                <p className="text-xs leading-5 text-gray-500">{t('sectionListFormatHelp')}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    {error && (
                      <Alert variant="destructive">
                        <AlertDescription className="break-words">{error}</AlertDescription>
                      </Alert>
                    )}

                    <p className="text-xs leading-5 text-gray-500">
                      {details?.isBuiltIn ? t('builtInTemplateHelp') : t('customTemplateHelp')}
                    </p>
                  </div>
                </ScrollArea>

                <DialogFooter className="flex-row items-center justify-between border-t border-gray-200 px-6 py-4 sm:justify-between sm:space-x-0">
                  <div>
                    {details?.isCustomized && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={isSaving || isDeleting}
                        onClick={handleDeleteOrRestore}
                      >
                        {isDeleting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : details.isBuiltIn ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        {deleteArmed
                          ? t('confirmTemplateAction')
                          : details.isBuiltIn
                            ? t('restoreTemplateDefault')
                            : t('deleteCustomTemplate')}
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!details || isDirty || isSaving || isDeleting}
                      onClick={handleUseTemplate}
                    >
                      <FileText className="mr-2 h-4 w-4" />
                      {t('useTemplate')}
                    </Button>
                    <Button
                      type="button"
                      disabled={!isDirty || isSaving || isDeleting}
                      onClick={handleSave}
                    >
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {isSaving ? t('savingTemplate') : t('saveTemplate')}
                    </Button>
                  </div>
                </DialogFooter>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
