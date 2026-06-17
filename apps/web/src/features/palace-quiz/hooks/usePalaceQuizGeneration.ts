import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type {
  AiRuntimeOptions,
  AiScenarioRuntimeOptionsMap,
  PalaceQuizGenerationPreview,
  PalaceQuizMiniPalaceClassificationResult,
  PalaceQuizPdfSourceMeta,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
import type { ImportSubjectOption } from '@/features/palace-edit/model/mindmap-import-types'
import { usePdfImportController } from '@/features/palace-edit/hooks/usePdfImportController'
import {
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  getSubjectTreeApi,
  getSubjectsApi,
  recoverAndSavePalaceQuizGenerationFromAiLogApi,
  uploadSubjectDocumentApi,
} from '@/features/palace-quiz/api/palaceQuizApi'
import {
  generatePalaceQuizPreview,
  getGenerationPreviewSaveCount,
  type QuizGenerationPdfSourceDraft as QuizPdfSourceDraft,
} from '@/features/palace-quiz/quizGenerationController'
import {
  buildChapterSummary,
  collectAllowedChapterIds,
  getQuestionTypeLabel,
  resolveChapterInfoFromTrees,
  shouldShowPdfPairingModelSelector,
  formatResolvedAiSteps,
  type PalaceQuizPageMeta,
  type QuizGenerationSourceKind,
  type SubjectTreePayload,
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
  const [generationSourceKind, setGenerationSourceKind] =
    useState<QuizGenerationSourceKind>('subject-pdf')
  const [generationFiles, setGenerationFiles] = useState<File[]>([])
  const [generationPreview, setGenerationPreview] = useState<PalaceQuizGenerationPreview | null>(
    null,
  )
  const [generationPdfSources, setGenerationPdfSources] = useState<QuizPdfSourceDraft[]>([])
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
  const [subjects, setSubjects] = useState<Array<{ id: number; name: string }>>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [rangeDialogOpen, setRangeDialogOpen] = useState(false)
  const [chapterTrees, setChapterTrees] = useState<SubjectTreePayload[]>([])
  const [chapterTreesLoading, setChapterTreesLoading] = useState(false)
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)
  const [pendingChapterId, setPendingChapterId] = useState<number | null>(null)
  const generationStreamContentRef = useRef<HTMLPreElement | null>(null)
  const generationStreamAutoFollowRef = useRef(true)
  const subjectPdfUploadInputRef = useRef<HTMLInputElement | null>(null)

  const subjectOptions = useMemo<ImportSubjectOption[]>(
    () => subjects.map((subject) => ({ id: subject.id, name: subject.name })),
    [subjects],
  )
  const defaultSubjectId = useMemo(
    () => palace?.chapters?.find((chapter) => chapter.subject?.id)?.subject?.id ?? null,
    [palace],
  )
  const pdfController = usePdfImportController({
    entityKey: palaceId ? `palace_quiz_${palaceId}` : null,
    subjectOptions,
    defaultSubjectId,
    setError: setGenerationError,
  })

  const miniPalaces = palace?.mini_palaces || []
  const explicitPalaceChapterIds = useMemo(
    () =>
      new Set(
        (palace?.chapters || [])
          .filter((chapter) => chapter.is_explicit !== false)
          .map((chapter) => chapter.id),
      ),
    [palace],
  )
  const allowedChapterIds = useMemo(() => {
    if (explicitPalaceChapterIds.size === 0) return new Set<number>()
    const collector = new Set<number>()
    chapterTrees.forEach((tree) => {
      collectAllowedChapterIds(tree.chapters || [], explicitPalaceChapterIds, false, collector)
    })
    return collector
  }, [chapterTrees, explicitPalaceChapterIds])
  const selectedChapterInfo = useMemo(() => {
    const resolved = resolveChapterInfoFromTrees(chapterTrees, selectedChapterId)
    if (resolved) return resolved
    if (!selectedChapterId) return null
    const fallbackChapter =
      palace?.primary_chapter_id === selectedChapterId
        ? palace.primary_chapter
        : (palace?.chapters || []).find((chapter) => chapter.id === selectedChapterId)
    if (!fallbackChapter?.name) return null
    return {
      subjectName:
        ('subject' in fallbackChapter ? fallbackChapter.subject?.name : undefined) ||
        subjects.find((subject) => subject.id === fallbackChapter.subject_id)?.name ||
        '未命名学科',
      path: [
        {
          id: fallbackChapter.id,
          name: fallbackChapter.name,
          subject_id: fallbackChapter.subject_id,
          parent_id: fallbackChapter.parent_id,
          children: [],
        },
      ],
    }
  }, [chapterTrees, palace, selectedChapterId, subjects])
  const pendingChapterInfo = useMemo(
    () => resolveChapterInfoFromTrees(chapterTrees, pendingChapterId),
    [chapterTrees, pendingChapterId],
  )
  const selectedChapterSummary = buildChapterSummary(selectedChapterInfo)
  const pendingChapterSummary = buildChapterSummary(pendingChapterInfo)
  const selectedChapterHasChildren = Boolean(
    selectedChapterInfo?.path[selectedChapterInfo.path.length - 1]?.children?.length,
  )
  const selectedSubjectDocument = useMemo(
    () =>
      pdfController.subjectDocuments.find(
        (document: SubjectDocumentSummary) =>
          document.id === pdfController.selectedSubjectDocumentId,
      ) || null,
    [pdfController.selectedSubjectDocumentId, pdfController.subjectDocuments],
  )

  const getChapterHasChildren = (chapterId: number | null) => {
    if (!chapterId) return false
    const info = resolveChapterInfoFromTrees(chapterTrees, chapterId)
    return Boolean(info?.path[info.path.length - 1]?.children?.length)
  }

  useEffect(() => {
    let cancelled = false
    const loadSubjects = async () => {
      setSubjectsLoading(true)
      try {
        const result = await getSubjectsApi()
        if (cancelled) return
        setSubjects((result || []).map((item) => ({ id: item.id, name: item.name })))
      } catch {
        if (!cancelled) setSubjects([])
      } finally {
        if (!cancelled) setSubjectsLoading(false)
      }
    }
    void loadSubjects()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!palace) return
    setSelectedChapterId(palace.primary_chapter_id ?? null)
  }, [palace])

  useEffect(() => {
    if (!palace?.chapters?.length || chapterTrees.length > 0 || chapterTreesLoading) return
    void ensureChapterTreesLoaded()
  }, [chapterTrees.length, chapterTreesLoading, palace])

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

  useEffect(() => {
    if (!generationLoading || !generationStreamPreviewText) return
    const content = generationStreamContentRef.current
    if (content && generationStreamAutoFollowRef.current) {
      content.scrollTop = content.scrollHeight
    }
  }, [generationLoading, generationStreamPreviewText])

  const ensureChapterTreesLoaded = async () => {
    if (chapterTrees.length > 0 || chapterTreesLoading) return
    const subjectIds = Array.from(
      new Set(
        (palace?.chapters || [])
          .map((chapter) => chapter.subject?.id ?? chapter.subject_id ?? null)
          .filter((value): value is number => typeof value === 'number'),
      ),
    )
    if (subjectIds.length === 0) return
    setChapterTreesLoading(true)
    try {
      const trees = await Promise.all(subjectIds.map((subjectId) => getSubjectTreeApi(subjectId)))
      setChapterTrees(trees as SubjectTreePayload[])
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '加载章节范围失败。')
    } finally {
      setChapterTreesLoading(false)
    }
  }

  const handleOpenRangeDialog = async () => {
    registerQuizActivity('generation_open_range_dialog')
    setPendingChapterId(selectedChapterId)
    await ensureChapterTreesLoaded()
    setRangeDialogOpen(true)
  }

  const handleConfirmRangeSelection = () => {
    if (!pendingChapterId) {
      toast.error('请先选择一个章节范围。')
      return
    }
    setSelectedChapterId(pendingChapterId)
    setRangeDialogOpen(false)
  }

  const handleImageFileChange = (fileList: FileList | null) => {
    registerQuizActivity('generation_select_files')
    emitQuizFeedback('quiz_generate_attach_source', { label: '选图片', audioScope: 'local' })
    const nextFiles = Array.from(fileList || [])
    setGenerationFiles(
      generationSourceKind === 'image-single' ? nextFiles.slice(0, 1) : nextFiles,
    )
    setGenerationError('')
  }

  const handleUploadSubjectPdf = async (file: File) => {
    if (!pdfController.selectedSubjectId) return
    await uploadSubjectDocumentApi(pdfController.selectedSubjectId, file)
    toast.success('PDF 已上传到资料库')
    await pdfController.refreshSubjectDocuments()
  }

  const handleAddCurrentPdfSource = () => {
    registerQuizActivity('generation_add_pdf_source')
    if (!pdfController.selectedSubjectDocumentId || !selectedSubjectDocument) {
      emitQuizFeedback('quiz_error_missing_input', { label: '未选PDF', audioScope: 'local' })
      setGenerationError('请先选择一份 PDF 资料。')
      return
    }
    if (pdfController.selectedPdfPages.length === 0) {
      emitQuizFeedback('quiz_error_missing_input', { label: '未选页码', audioScope: 'local' })
      setGenerationError('请先为当前 PDF 选择至少一页。')
      return
    }
    const nextSource: QuizPdfSourceDraft = {
      subject_document_id: pdfController.selectedSubjectDocumentId,
      document_name: selectedSubjectDocument.original_name,
      page_selection: [...pdfController.selectedPdfPages],
      role_hint: 'question',
    }
    setGenerationPdfSources((current) => {
      const next = [...current]
      const existingIndex = next.findIndex(
        (item) => item.subject_document_id === nextSource.subject_document_id,
      )
      if (existingIndex >= 0) next[existingIndex] = nextSource
      else next.push(nextSource)
      return next
    })
    emitQuizFeedback('quiz_generate_attach_source', { label: '加入PDF', audioScope: 'local' })
    setGenerationError('')
  }

  const handleRemovePdfSource = (subjectDocumentId: number) => {
    registerQuizActivity('generation_remove_pdf_source')
    emitQuizFeedback('quiz_manage_delete', { label: '移除PDF', audioScope: 'local' })
    setGenerationPdfSources((current) =>
      current.filter((item) => item.subject_document_id !== subjectDocumentId),
    )
    setGenerationError('')
  }

  const handlePdfSourceRoleHintChange = (subjectDocumentId: number, roleHint: 'question' | 'answer') => {
    emitQuizFeedback('quiz_generate_attach_source', {
      label: roleHint === 'answer' ? '设为答案' : '设为题目',
      audioScope: 'local',
    })
    setGenerationPdfSources((current) =>
      current.map((item) =>
        item.subject_document_id === subjectDocumentId ? { ...item, role_hint: roleHint } : item,
      ),
    )
  }

  const handleGenerationStreamScroll = () => {
    const content = generationStreamContentRef.current
    if (!content) return
    const remaining = content.scrollHeight - content.scrollTop - content.clientHeight
    generationStreamAutoFollowRef.current = remaining <= 32
  }

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
    generationStreamAutoFollowRef.current = true
    try {
      if (config.classifyByMiniPalace && !selectedChapterHasChildren) {
        emitQuizFeedback('quiz_error_missing_input', { label: '无小宫殿', audioScope: 'local' })
        throw new Error('当前范围没有直接子章节，无法分类保存。')
      }
      let aiOptions: AiRuntimeOptions | undefined
      let aiOptionsByScenario: AiScenarioRuntimeOptionsMap | undefined
      if (config.sourceKind === 'subject-pdf') {
        if (shouldShowPdfPairingModelSelector(config.pdfSources)) {
          aiOptionsByScenario = await promptForScenarioAiOptions({
            title: 'PDF 做题生成配置',
            description: '先选 VL 识别模型，再选题目与答案配对模型。本次请求会直接使用，并同步更新对应场景默认模型。',
            entries: [
              {
                scenarioKey: 'quiz_pdf_generation',
                entrypointKey: 'quiz-generate-pdf',
                label: 'VL 识别模型',
                description: '负责逐页识别题干、选项、答案候选和解析候选，不负责最终题答配对。',
              },
              {
                scenarioKey: 'quiz_pdf_pairing',
                entrypointKey: 'quiz-generate-pdf-pairing',
                label: '文本配对模型',
                description: '负责把题目册和答案册候选配对成最终题库。',
              },
            ],
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
        const groupedPreview = generationPreview.grouped_questions
        const questionsToSave = groupedPreview
          ? groupedPreview.child_chapter_groups
            ? [
                ...groupedPreview.child_chapter_groups.flatMap((group) =>
                  group.questions.map((question) => ({
                    ...question,
                    source_chapter_id: selectedChapterId,
                    classified_chapter_id: group.classified_chapter_id,
                    mini_palace_id: null,
                  })),
                ),
                ...groupedPreview.unassigned_questions.map((question) => ({
                  ...question,
                  source_chapter_id: selectedChapterId,
                  classified_chapter_id: null,
                  mini_palace_id: null,
                })),
              ]
            : [
                ...(groupedPreview.mini_palace_groups || []).flatMap((group) => group.questions),
                ...groupedPreview.unassigned_questions.map((question) => ({
                  ...question,
                  mini_palace_id: null,
                })),
              ]
          : generationPreview.questions.map((question) => ({
              ...question,
              source_chapter_id: selectedChapterId,
              classified_chapter_id: null,
              mini_palace_id: null,
            }))
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
