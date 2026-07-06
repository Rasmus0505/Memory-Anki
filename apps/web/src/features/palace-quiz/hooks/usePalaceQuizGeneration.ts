import { useEffect, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type {
  AiRuntimeOptions,
  AiScenarioRuntimeOptionsMap,
  PalaceQuizGenerationPreview,
  PalaceQuizMiniPalaceClassificationResult,
} from '@/shared/api/contracts'
import {
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
} from '@/features/palace-quiz/api'
import {
  buildGeneratedQuestionsForChapterSave,
  generatePalaceQuizPreview,
  getGenerationPreviewSaveCount,
} from '@/features/palace-quiz/quizGenerationController'
import {
  getQuestionTypeLabel,
  formatResolvedAiSteps,
  type PalaceQuizPageMeta,
  type QuizGenerationSourceKind,
} from '@/features/palace-quiz/model/palaceQuizPage'
import {
  buildQuizGenerationHistoryTitle,
  deleteQuizGenerationHistory,
  getPreviewQuestionCount,
  loadQuizGenerationHistory,
  saveQuizGenerationHistory,
  type QuizGenerationHistoryItem,
} from '@/features/palace-quiz/quiz-generation-history'
import { persistQuizGenerationHistory } from '@/features/palace-quiz/model/persistQuizGenerationHistory'
import { usePalaceQuizGenerationInputs } from './usePalaceQuizGenerationInputs'

export function usePalaceQuizGeneration({
  palaceId,
  palace,
  refreshQuestions,
  promptForAiOptions,
  promptForScenarioAiOptions,
  registerQuizActivity,
  emitQuizFeedback,
}: {
  palaceId: number | null
  palace: PalaceQuizPageMeta | null
  refreshQuestions: () => Promise<void>
  promptForAiOptions: (options: {
    scenarioKey: string
    entrypointKey: string
    title: string
  }) => Promise<AiRuntimeOptions | null | undefined>
  promptForScenarioAiOptions: (options: {
    title: string
    description: string
    entries: Array<{
      scenarioKey: string
      entrypointKey: string
      label: string
      description: string
    }>
  }) => Promise<AiScenarioRuntimeOptionsMap | null | undefined>
  registerQuizActivity: (source: string) => void
  emitQuizFeedback: (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => void
}) {
  const [generationPreview, setGenerationPreview] = useState<PalaceQuizGenerationPreview | null>(
    null,
  )
  const [generationLoading, setGenerationLoading] = useState(false)
  const [generationSaving, setGenerationSaving] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [generationStreamStatus, setGenerationStreamStatus] = useState('')
  const [generationStreamStepLabel, setGenerationStreamStepLabel] = useState('')
  const [generationStreamPreviewText, setGenerationStreamPreviewText] = useState('')
  const [generationClassifyByMiniPalace, setGenerationClassifyByMiniPalace] = useState(false)
  const [generationEnableSecondaryReview, setGenerationEnableSecondaryReview] = useState(false)
  const [generationSaveMode, setGenerationSaveMode] = useState<'append' | 'overwrite'>('append')
  const [generationHistory, setGenerationHistory] = useState<QuizGenerationHistoryItem[]>([])
  const [historyRegeneratingId, setHistoryRegeneratingId] = useState<string | null>(null)
  const [classificationLoading, setClassificationLoading] = useState(false)
  const [classificationResult, setClassificationResult] =
    useState<PalaceQuizMiniPalaceClassificationResult | null>(null)
  const generationInputs = usePalaceQuizGenerationInputs({
    palace,
    generationLoading,
    generationStreamPreviewText,
    registerQuizActivity,
    emitQuizFeedback,
    setGenerationError,
  })
  const {
    generationSourceKind,
    setGenerationSourceKind,
    generationFiles,
    setGenerationFiles,
    extraPrompt,
    setExtraPrompt,
    subjectsLoading,
    rangeDialogOpen,
    setRangeDialogOpen,
    chapterTrees,
    chapterTreesLoading,
    selectedChapterId,
    setSelectedChapterId,
    selectedChapterSummary,
    pendingChapterId,
    pendingChapterSummary,
    allowedChapterIds,
    selectedChapterHasChildren,
    generationStreamContentRef,
    miniPalaces,
    handleOpenRangeDialog,
    handleConfirmRangeSelection,
    setPendingChapterId,
    handleImageFileChange,
    handleGenerationStreamScroll,
    resetGenerationStreamFollow,
    getChapterHasChildren,
  } = generationInputs

  useEffect(() => {
    if (typeof window === 'undefined' || !palaceId) {
      setGenerationHistory([])
      return
    }
    setGenerationHistory(loadQuizGenerationHistory(palaceId))
  }, [palaceId])

  useEffect(() => {
    if (generationClassifyByMiniPalace && !selectedChapterHasChildren) {
      setGenerationClassifyByMiniPalace(false)
    }
  }, [generationClassifyByMiniPalace, selectedChapterHasChildren])

  const applyHistoryConfig = (item: QuizGenerationHistoryItem) => {
    const nextSelectedChapterId = item.selectedChapterId ?? palace?.primary_chapter_id ?? null
    setGenerationSourceKind(item.sourceKind)
    setExtraPrompt(item.extraPrompt)
    setGenerationEnableSecondaryReview(item.enableSecondaryReview)
    setGenerationClassifyByMiniPalace(
      item.classifyByMiniPalace && getChapterHasChildren(nextSelectedChapterId),
    )
    setSelectedChapterId(nextSelectedChapterId)
    setGenerationError('')
    setGenerationPreview(null)
    setGenerationStreamStatus('')
    setGenerationStreamStepLabel('')
    setGenerationStreamPreviewText('')

    setGenerationFiles([])
    toast.message('历史配置已载入，源文件需要重新上传后才能再次生成。')
  }

  const executeGenerationPreview = async (config: {
    sourceKind: QuizGenerationSourceKind
    files: File[]
    extraPrompt: string
    enableSecondaryReview: boolean
    classifyByMiniPalace: boolean
  }) => {
    if (!palaceId) return
    if (!selectedChapterId) {
      setGenerationError('请先选择题目所属章节范围。')
      return
    }
    setGenerationLoading(true)
    setGenerationError('')
    setGenerationPreview(null)
    setGenerationStreamStatus('')
    setGenerationStreamStepLabel('')
    setGenerationStreamPreviewText('')
    resetGenerationStreamFollow()
    try {
      if (config.classifyByMiniPalace && !selectedChapterHasChildren) {
        emitQuizFeedback('quiz_error_missing_input', { label: '无训练关卡', audioScope: 'local' })
        throw new Error('当前范围没有直接子章节，无法分类保存。')
      }
      let aiOptions: AiRuntimeOptions | undefined
      if (config.sourceKind === 'text-files') {
        aiOptions = (await promptForAiOptions({
          scenarioKey: 'quiz_text_generation',
          entrypointKey: 'quiz-generate-text-files',
          title: '文本做题导入配置',
        })) || undefined
      } else {
        aiOptions = (await promptForAiOptions({
          scenarioKey: 'quiz_image_generation',
          entrypointKey:
            config.sourceKind === 'image-batch'
              ? 'quiz-generate-images-batch'
              : 'quiz-generate-images-single',
          title: '图片做题生成配置',
        })) || undefined
      }
      if (!aiOptions) {
        emitQuizFeedback('quiz_generate_cancel', { label: '取消生成', audioScope: 'global' })
        setGenerationLoading(false)
        return
      }
      const preview = await generatePalaceQuizPreview({
        palaceId,
        sourceKind: config.sourceKind,
        extraPrompt: config.extraPrompt,
        aiOptions,
        files: config.files,
        enableSecondaryReview: config.enableSecondaryReview,
          classifyByMiniPalace: config.classifyByMiniPalace,
          selectedChapterId,
          aiOptionsByScenario: undefined,
          onStatus: (event) => {
          setGenerationStreamStatus(event.message || '正在生成题目')
          setGenerationStreamStepLabel(
            event.step != null && event.total != null ? `第 ${event.step}/${event.total} 步` : '',
          )
        },
        onDelta: (event) => {
          setGenerationStreamPreviewText((current) => `${current}${event.text || ''}`)
        },
      })
      setGenerationPreview(preview)
      emitQuizFeedback('quiz_generate_preview_ready', {
        label: config.sourceKind === 'text-files' ? '文本预览' : '图片预览',
        audioScope: 'global',
      })
      const history = persistQuizGenerationHistory(
        palaceId,
        preview,
        config.sourceKind,
        config.files.map((file) => file.name),
        config.extraPrompt,
        config.enableSecondaryReview,
        config.classifyByMiniPalace,
        selectedChapterId,
        selectedChapterSummary,
      )
      if (history) setGenerationHistory(history)
    } catch (nextError) {
      emitQuizFeedback('quiz_error_ai_failed', { label: '生成失败', audioScope: 'global' })
      setGenerationError(nextError instanceof Error ? nextError.message : '生成题目预览失败。')
    } finally {
      setGenerationLoading(false)
    }
  }

  const handleGeneratePreview = async () => {
    registerQuizActivity('generation_preview')
    emitQuizFeedback('quiz_generate_start', { label: '生成预览', audioScope: 'global' })
    await executeGenerationPreview({
      sourceKind: generationSourceKind,
      files: generationFiles,
      extraPrompt,
      enableSecondaryReview: generationEnableSecondaryReview,
      classifyByMiniPalace: generationClassifyByMiniPalace,
    })
  }

  const handleRegenerateFromHistory = async (item: QuizGenerationHistoryItem) => {
    registerQuizActivity('generation_history_regenerate')
    emitQuizFeedback('quiz_generate_start', { label: '历史重生成', audioScope: 'global' })
    applyHistoryConfig(item)
  }

  const handleDeleteGenerationHistory = (historyId: string) => {
    if (!palaceId) return
    setGenerationHistory(deleteQuizGenerationHistory(palaceId, historyId))
  }

  const handleSaveGenerationPreview = async () => {
    if (!palaceId || !selectedChapterId || !generationPreview || generationPreview.questions.length === 0) return
    registerQuizActivity('generation_save_preview')
    emitQuizFeedback('quiz_generate_save', { label: '写入题库', audioScope: 'global' })
    setGenerationSaving(true)
    try {
      const questionsToSave = buildGeneratedQuestionsForChapterSave(
        generationPreview,
        selectedChapterId,
      )
      await batchCreateChapterQuizQuestionsApi(
        selectedChapterId,
        questionsToSave,
        generationSaveMode,
      )
      toast.success(`已保存 ${questionsToSave.length} 道 AI 题目到题库。`)
      emitQuizFeedback('quiz_generate_save', { label: '已入题库', audioScope: 'global' })
      await refreshQuestions()
      setGenerationPreview(null)
    } catch (nextError) {
      emitQuizFeedback('quiz_error_persist_failed', { label: '写入失败', audioScope: 'global' })
      if (nextError instanceof Error) {
        const requestId =
          typeof (nextError as Error & { requestId?: string }).requestId === 'string'
            ? (nextError as Error & { requestId?: string }).requestId
            : ''
        toast.error(requestId ? `${nextError.message}（请求ID：${requestId}）` : nextError.message)
      } else {
        toast.error('保存 AI 题目失败，请重新生成预览后再试。')
      }
    } finally {
      setGenerationSaving(false)
    }
  }

  const handleClassifyExistingQuestions = async () => {
    if (!palaceId) return
    registerQuizActivity('generation_classify_existing_to_mini_palaces')
    emitQuizFeedback('quiz_generate_start', { label: '归类题库', audioScope: 'global' })
    setClassificationLoading(true)
    setClassificationResult(null)
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'quiz_mini_palace_grouping',
        entrypointKey: 'quiz-classify-existing-mini-palace',
        title: '已有题库归类配置',
      })
      if (!aiOptions) {
        emitQuizFeedback('quiz_generate_cancel', { label: '取消归类', audioScope: 'global' })
        setClassificationLoading(false)
        return
      }
      const result = await classifyPalaceQuizQuestionsToMiniPalacesApi(palaceId, aiOptions)
      setClassificationResult(result)
      toast.success('已有题库已按训练关卡重新归类。')
      emitQuizFeedback('quiz_generate_classify_complete', { label: '归类完成', audioScope: 'global' })
      await refreshQuestions()
    } catch (nextError) {
      emitQuizFeedback('quiz_error_ai_failed', { label: '归类失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '归类训练关卡题库失败，请稍后重试。')
    } finally {
      setClassificationLoading(false)
    }
  }

  return {
    generationSourceKind,
    setGenerationSourceKind,
    generationFiles,
    setGenerationFiles,
    extraPrompt,
    setExtraPrompt,
    generationPreview,
    setGenerationPreview,
    generationLoading,
    generationSaving,
    generationError,
    setGenerationError,
    generationStreamStatus,
    generationStreamStepLabel,
    generationStreamPreviewText,
    generationClassifyByMiniPalace,
    setGenerationClassifyByMiniPalace,
    generationEnableSecondaryReview,
    setGenerationEnableSecondaryReview,
    generationSaveMode,
    setGenerationSaveMode,
    generationHistory,
    historyRegeneratingId,
    classificationLoading,
    classificationResult,
    subjectsLoading,
    rangeDialogOpen,
    setRangeDialogOpen,
    chapterTrees,
    chapterTreesLoading,
    selectedChapterId,
    selectedChapterSummary,
    pendingChapterId,
    pendingChapterSummary,
    allowedChapterIds,
    selectedChapterHasChildren,
    generationStreamContentRef,
    miniPalaces,
    handleOpenRangeDialog,
    handleConfirmRangeSelection,
    setPendingChapterId,
    handleImageFileChange,
    handleGenerationStreamScroll,
    resetGenerationStreamFollow,
    handleGeneratePreview,
    handleRegenerateFromHistory,
    handleDeleteGenerationHistory,
    handleSaveGenerationPreview,
    handleClassifyExistingQuestions,
    applyHistoryConfig,
    getChapterHasChildren,
    getGenerationPreviewSaveCount,
    getQuestionTypeLabel,
    formatResolvedAiSteps,
  }
}
