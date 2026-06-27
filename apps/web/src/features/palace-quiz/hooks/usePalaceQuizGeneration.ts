import { useEffect, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type {
  AiRuntimeOptions,
  AiScenarioRuntimeOptionsMap,
  PalaceQuizGenerationPreview,
  PalaceQuizMiniPalaceClassificationResult,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
import {
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  recoverAndSavePalaceQuizGenerationFromAiLogApi,
} from '@/features/palace-quiz/api/palaceQuizApi'
import {
  buildGeneratedQuestionsForChapterSave,
  generatePalaceQuizPreview,
  getGenerationPreviewSaveCount,
  type QuizGenerationPdfSourceDraft as QuizPdfSourceDraft,
} from '@/features/palace-quiz/quizGenerationController'
import {
  getQuestionTypeLabel,
  shouldShowPdfPairingModelSelector,
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
  const [generationHistory, setGenerationHistory] = useState<QuizGenerationHistoryItem[]>([])
  const [historyRegeneratingId, setHistoryRegeneratingId] = useState<string | null>(null)
  const [classificationLoading, setClassificationLoading] = useState(false)
  const [classificationResult, setClassificationResult] =
    useState<PalaceQuizMiniPalaceClassificationResult | null>(null)
  const generationInputs = usePalaceQuizGenerationInputs({
    palaceId,
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
    generationPdfSources,
    setGenerationPdfSources,
    subjectsLoading,
    subjectOptions,
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
    selectedSubjectDocument,
    pdfController,
    generationStreamContentRef,
    subjectPdfUploadInputRef,
    miniPalaces,
    handleOpenRangeDialog,
    handleConfirmRangeSelection,
    setPendingChapterId,
    handleImageFileChange,
    handleUploadSubjectPdf,
    handleAddCurrentPdfSource,
    handleRemovePdfSource,
    handlePdfSourceRoleHintChange,
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
    setGenerationPdfSources(
      item.pdfSources.map((source) => ({
        subject_document_id: source.subject_document_id,
        document_name: source.document_name,
        page_selection: [...source.page_selection],
        role_hint: source.role_hint,
      })),
    )
    pdfController.setRangePrompt(item.extraPrompt)
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

    const firstSource = item.pdfSources[0]
    if (firstSource) {
      const matchingDocument = pdfController.subjectDocuments.find(
        (document: SubjectDocumentSummary) => document.id === firstSource.subject_document_id,
      )
      if (matchingDocument) {
        pdfController.setSelectedSubjectId(matchingDocument.subject_id)
      }
      pdfController.setSelectedSubjectDocumentId(firstSource.subject_document_id)
      pdfController.setSelectedPdfPages(firstSource.page_selection)
      pdfController.setPdfPageInput(firstSource.page_selection.join(','))
    }

    if (item.sourceKind !== 'subject-pdf') {
      setGenerationFiles([])
      toast.message('历史配置已载入，图片需要重新上传后才能再次生成。')
      return
    }
    toast.success('历史配置已载入左侧。')
  }

  const executeGenerationPreview = async (config: {
    sourceKind: QuizGenerationSourceKind
    pdfSources: QuizPdfSourceDraft[]
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
        emitQuizFeedback('quiz_error_missing_input', { label: '无小宫殿', audioScope: 'local' })
        throw new Error('当前范围没有直接子章节，无法分类保存。')
      }
      let aiOptions: AiRuntimeOptions | undefined
      let aiOptionsByScenario: AiScenarioRuntimeOptionsMap | undefined
      if (config.sourceKind === 'subject-pdf') {
        const pdfConfigEntries: Array<{
          scenarioKey: string
          entrypointKey: string
          label: string
          description: string
        }> = [
          {
            scenarioKey: 'quiz_pdf_generation',
            entrypointKey: 'quiz-generate-pdf',
            label: '识别模型',
            description: '负责逐页识别题干、选项、答案候选和解析候选。',
          },
        ]
        if (shouldShowPdfPairingModelSelector(config.pdfSources)) {
          pdfConfigEntries.push({
            scenarioKey: 'quiz_pdf_pairing',
            entrypointKey: 'quiz-generate-pdf-pairing',
            label: '文本配对模型',
            description: '负责把题目册和答案册候选配对成最终题库。',
          })
        }
        if (config.enableSecondaryReview) {
          pdfConfigEntries.push({
            scenarioKey: 'quiz_pdf_review',
            entrypointKey: 'quiz-generate-pdf-review',
            label: '二次复核模型',
            description: '负责按额外提示词对已生成题目做范围复核和筛除。',
          })
        }
        if (pdfConfigEntries.length > 1) {
          aiOptionsByScenario = await promptForScenarioAiOptions({
            title: 'PDF 做题生成配置',
            description: '可分别调整识别、配对和复核步骤的模型与提示词。本次请求会直接使用。',
            entries: pdfConfigEntries,
          }) || undefined
          aiOptions = aiOptionsByScenario?.quiz_pdf_generation
        } else {
          aiOptions = (await promptForAiOptions({
            scenarioKey: 'quiz_pdf_generation',
            entrypointKey: 'quiz-generate-pdf',
            title: 'PDF 做题生成配置',
          })) || undefined
        }
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
        pdfSources: config.pdfSources,
        enableSecondaryReview: config.enableSecondaryReview,
        classifyByMiniPalace: config.classifyByMiniPalace,
        selectedChapterId,
        aiOptionsByScenario,
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
      if (config.sourceKind === 'subject-pdf') {
        setGenerationStreamStatus('题目预览已生成')
        emitQuizFeedback('quiz_generate_preview_ready', {
          label: config.classifyByMiniPalace ? '分组预览' : '题目预览',
          audioScope: 'global',
        })
        config.pdfSources.forEach((item) => {
          pdfController.persistAnalyzedPdfPages(item.subject_document_id, item.page_selection)
        })
        const history = persistQuizGenerationHistory(
          palaceId,
          preview,
          config.sourceKind,
          config.pdfSources,
          [],
          config.extraPrompt,
          config.enableSecondaryReview,
          config.classifyByMiniPalace,
          selectedChapterId,
          selectedChapterSummary,
        )
        if (history) setGenerationHistory(history)
      } else {
        emitQuizFeedback('quiz_generate_preview_ready', { label: '图片预览', audioScope: 'global' })
        const history = persistQuizGenerationHistory(
          palaceId,
          preview,
          config.sourceKind,
          [],
          config.files.map((file) => file.name),
          config.extraPrompt,
          config.enableSecondaryReview,
          config.classifyByMiniPalace,
          selectedChapterId,
          selectedChapterSummary,
        )
        if (history) setGenerationHistory(history)
      }
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
      pdfSources: generationPdfSources,
      files: generationFiles,
      extraPrompt: pdfController.rangePrompt,
      enableSecondaryReview: generationEnableSecondaryReview,
      classifyByMiniPalace: generationClassifyByMiniPalace,
    })
  }

  const handleRegenerateFromHistory = async (item: QuizGenerationHistoryItem) => {
    registerQuizActivity('generation_history_regenerate')
    emitQuizFeedback('quiz_generate_start', { label: '历史重生成', audioScope: 'global' })
    if (item.sourceKind !== 'subject-pdf') {
      applyHistoryConfig(item)
      return
    }
    setHistoryRegeneratingId(item.id)
    try {
      await executeGenerationPreview({
        sourceKind: item.sourceKind,
        pdfSources: item.pdfSources.map((source) => ({
          subject_document_id: source.subject_document_id,
          document_name: source.document_name,
          page_selection: [...source.page_selection],
          role_hint: source.role_hint,
        })),
        files: [],
        extraPrompt: item.extraPrompt,
        enableSecondaryReview: item.enableSecondaryReview,
        classifyByMiniPalace: item.classifyByMiniPalace,
      })
    } finally {
      setHistoryRegeneratingId(null)
    }
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
      const aiCallLogId =
        generationPreview.ai_call_log_id || generationPreview.source_meta?.ai_call_log_id || ''
      if (aiCallLogId) {
        const result = await recoverAndSavePalaceQuizGenerationFromAiLogApi(palaceId, {
          ai_call_log_id: aiCallLogId,
          selected_chapter_id: selectedChapterId,
          classify_by_mini_palace: Boolean(generationPreview.grouped_questions),
        })
        toast.success(`题目已保存到题库，本次写入 ${result.saved_count} 题。`)
      } else {
        const questionsToSave = buildGeneratedQuestionsForChapterSave(
          generationPreview,
          selectedChapterId,
        )
        await batchCreateChapterQuizQuestionsApi(selectedChapterId, questionsToSave)
        toast.success('题目已保存到题库')
      }
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
        toast.error('保存 AI 题目失败。')
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
      toast.success('已有题库已按小宫殿归类')
      emitQuizFeedback('quiz_generate_classify_complete', { label: '归类完成', audioScope: 'global' })
      await refreshQuestions()
    } catch (nextError) {
      emitQuizFeedback('quiz_error_ai_failed', { label: '归类失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '归类小宫殿题库失败。')
    } finally {
      setClassificationLoading(false)
    }
  }

  return {
    generationSourceKind,
    setGenerationSourceKind,
    generationFiles,
    setGenerationFiles,
    generationPreview,
    setGenerationPreview,
    generationPdfSources,
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
    generationHistory,
    historyRegeneratingId,
    classificationLoading,
    classificationResult,
    subjectsLoading,
    subjectOptions,
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
    selectedSubjectDocument,
    pdfController,
    generationStreamContentRef,
    subjectPdfUploadInputRef,
    miniPalaces,
    handleOpenRangeDialog,
    handleConfirmRangeSelection,
    setPendingChapterId,
    handleImageFileChange,
    handleUploadSubjectPdf,
    handleAddCurrentPdfSource,
    handleRemovePdfSource,
    handlePdfSourceRoleHintChange,
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
