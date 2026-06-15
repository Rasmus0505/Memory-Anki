import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  FileText,
  ImagePlus,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { useRouteResidency } from '@/app/router/RouteResidency'
import type {
  MiniPalaceSummary,
  PalaceQuizPdfSourceMeta,
  PalaceQuizPdfSourceRole,
  PalaceQuizMiniPalaceClassificationResult,
  PalaceQuizGenerationPreview,
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceQuizSourceMeta,
  PalaceShortAnswerFeedback,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
import { getSubjectsApi, uploadSubjectDocumentApi } from '@/shared/api/modules/knowledge'
import { getPalaceApi } from '@/shared/api/modules/palaces'
import {
  batchCreatePalaceQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  getPalaceQuizQuestionsApi,
  previewPalaceQuizGenerationFromImagesApi,
  previewPalaceQuizGenerationFromPdfStreamApi,
  recordPalaceQuizChoiceAttemptApi,
  requestPalaceShortAnswerFeedbackApi,
  updatePalaceQuizQuestionApi,
} from '@/shared/api/modules/quizzes'
import { usePdfImportController } from '@/features/palace-edit/hooks/usePdfImportController'
import type { ImportSubjectOption } from '@/features/palace-edit/model/mindmap-import-types'

type PalaceQuizTabKey = 'practice' | 'manage' | 'generate'
type PalaceQuizViewMode = 'single' | 'list'
type QuizGenerationSourceKind = 'subject-pdf' | 'image-single' | 'image-batch'
type PalaceQuizScopeKey = 'all' | 'palace' | `mini:${number}`

interface QuizPdfSourceDraft {
  subject_document_id: number
  document_name: string
  page_selection: number[]
  role_hint: PalaceQuizPdfSourceRole
}

interface PalaceQuizPageMeta {
  id: number
  title: string
  mini_palaces?: MiniPalaceSummary[]
  chapters?: Array<{
    id: number
    subject?: { id: number; name: string } | null
  }>
}

interface QuizCardState {
  selectedOptionId?: string | null
  choiceResolved?: boolean
  choiceCorrect?: boolean
  shortAnswerText?: string
  shortAnswerSubmitted?: boolean
  aiFeedback?: PalaceShortAnswerFeedback | null
  aiFeedbackLoading?: boolean
}

interface QuestionFormState {
  question_type: PalaceQuizQuestionType
  stem: string
  options: Array<{ id: string; text: string }>
  correct_option_id: string
  reference_answer: string
  analysis: string
  source_meta: PalaceQuizSourceMeta
}

const QUIZ_VIEW_MODE_STORAGE_KEY = 'memory_anki_palace_quiz_view_mode'

function buildManualSourceMeta(): PalaceQuizSourceMeta {
  return {
    source_kind: 'manual',
    subject_document_id: null,
    page_numbers: null,
    image_names: null,
    pdf_sources: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: new Date().toISOString(),
    generation_mode: 'manual',
  }
}

function buildEmptyQuestionForm(): QuestionFormState {
  return {
    question_type: 'multiple_choice',
    stem: '',
    options: [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
    ],
    correct_option_id: 'A',
    reference_answer: '',
    analysis: '',
    source_meta: buildManualSourceMeta(),
  }
}

function buildQuestionFormFromQuestion(question: PalaceQuizQuestion): QuestionFormState {
  return {
    question_type: question.question_type,
    stem: question.stem,
    options:
      question.question_type === 'multiple_choice'
        ? (question.options || []).map((option) => ({
            id: option.id,
            text: option.text,
          }))
        : [
            { id: 'A', text: '' },
            { id: 'B', text: '' },
          ],
    correct_option_id: question.answer_payload.correct_option_id || 'A',
    reference_answer: question.answer_payload.reference_answer || '',
    analysis: question.analysis || '',
    source_meta: question.source_meta || buildManualSourceMeta(),
  }
}

function buildDraftFromForm(form: QuestionFormState): PalaceQuizQuestionDraft {
  const stem = form.stem.trim()
  if (!stem) {
    throw new Error('题干不能为空。')
  }
  if (form.question_type === 'multiple_choice') {
    const options = form.options
      .map((option, index) => ({
        id: option.id || String.fromCharCode(65 + index),
        text: option.text.trim(),
      }))
      .filter((option) => option.text)
    if (options.length < 2) {
      throw new Error('选择题至少需要 2 个选项。')
    }
    const correctOptionId = form.correct_option_id.trim()
    if (!correctOptionId || !options.some((option) => option.id === correctOptionId)) {
      throw new Error('请选择一个正确选项。')
    }
    return {
      question_type: 'multiple_choice',
      stem,
      options,
      answer_payload: { correct_option_id: correctOptionId },
      analysis: form.analysis.trim(),
      source_meta: form.source_meta,
    }
  }
  const referenceAnswer = form.reference_answer.trim()
  if (!referenceAnswer) {
    throw new Error('简答题必须填写参考答案。')
  }
  return {
    question_type: 'short_answer',
    stem,
    options: [],
    answer_payload: { reference_answer: referenceAnswer },
    analysis: form.analysis.trim(),
    source_meta: form.source_meta,
  }
}

function getOptionTone(
  question: PalaceQuizQuestion,
  state: QuizCardState | undefined,
  optionId: string,
) {
  if (!state?.choiceResolved) return 'outline'
  const correctOptionId = question.answer_payload.correct_option_id
  if (optionId === correctOptionId) return 'correct'
  if (state.selectedOptionId === optionId && !state.choiceCorrect) return 'incorrect'
  return 'idle'
}

function readPersistedViewMode(): PalaceQuizViewMode {
  if (typeof window === 'undefined') return 'single'
  const raw = window.localStorage.getItem(QUIZ_VIEW_MODE_STORAGE_KEY)
  return raw === 'list' ? 'list' : 'single'
}

function getQuestionOwnershipLabel(question: PalaceQuizQuestion) {
  return question.mini_palace?.name ? `小宫殿：${question.mini_palace.name}` : '主宫殿题'
}

function getQuestionSourceLabel(sourceMeta?: PalaceQuizSourceMeta | null) {
  const sourceKind = sourceMeta?.source_kind || 'manual'
  if (sourceKind === 'manual') return '手动'
  if (sourceKind === 'subject_pdf') return 'PDF生成'
  if (sourceKind === 'image' || sourceKind === 'images' || sourceKind === 'image_upload') {
    return '图片AI生成'
  }
  return 'AI生成'
}

function getGenerationPreviewSaveCount(preview: PalaceQuizGenerationPreview | null) {
  if (!preview) return 0
  if (!preview.grouped_questions) return preview.questions.length
  return (
    preview.grouped_questions.mini_palace_groups.reduce(
      (total, group) => total + group.questions.length,
      0,
    ) + preview.grouped_questions.unassigned_questions.length
  )
}

function getPdfSourceRoleLabel(roleHint?: string | null) {
  return roleHint === 'answer' ? '答案' : '题目'
}

function QuestionSourceBadge({
  sourceMeta,
  compact = false,
}: {
  sourceMeta?: PalaceQuizSourceMeta | null
  compact?: boolean
}) {
  const label = getQuestionSourceLabel(sourceMeta)
  const pdfSources = sourceMeta?.pdf_sources || []
  const hasDetails = pdfSources.length > 0 || Boolean(sourceMeta?.ai_call_log_id)

  if (!hasDetails) {
    return <Badge variant="outline">{label}</Badge>
  }

  return (
    <details className={cn('group text-xs text-muted-foreground', compact ? 'w-full' : '')}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-2">
        <Badge variant="outline">{label}</Badge>
        <span className="text-[11px] text-muted-foreground group-open:hidden">展开来源</span>
        <span className="hidden text-[11px] text-muted-foreground group-open:inline">收起来源</span>
      </summary>
      <div className="mt-2 space-y-1 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
        {pdfSources.map((source, index) => (
          <div key={`${source.subject_document_id ?? 'pdf'}_${index}`}>
            {source.document_name || `PDF ${index + 1}`}
            {source.page_numbers?.length ? ` · 页码 ${source.page_numbers.join(', ')}` : ''}
            {source.role_hint ? ` · ${getPdfSourceRoleLabel(source.role_hint)}` : ''}
          </div>
        ))}
        {sourceMeta?.ai_call_log_id ? <div>AI日志 {sourceMeta.ai_call_log_id}</div> : null}
      </div>
    </details>
  )
}

export default function PalaceQuizPage() {
  const { isActive } = useRouteResidency()
  const { id } = useParams()
  const palaceId = id ? Number(id) : null
  const [palace, setPalace] = useState<PalaceQuizPageMeta | null>(null)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [activeTab, setActiveTab] = useState<PalaceQuizTabKey>('practice')
  const [viewMode, setViewMode] = useState<PalaceQuizViewMode>(readPersistedViewMode)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questionScope, setQuestionScope] = useState<PalaceQuizScopeKey>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [questionStates, setQuestionStates] = useState<Record<number, QuizCardState>>({})
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null)
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(buildEmptyQuestionForm)
  const [manageSaving, setManageSaving] = useState(false)
  const [manageDeletingId, setManageDeletingId] = useState<number | null>(null)
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
  const [classificationLoading, setClassificationLoading] = useState(false)
  const [classificationResult, setClassificationResult] = useState<PalaceQuizMiniPalaceClassificationResult | null>(null)
  const [subjects, setSubjects] = useState<Array<{ id: number; name: string }>>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const timer = useTimedSession({
    kind: 'quiz',
    title: palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题',
    palaceId,
    automationScene: 'quiz',
    sourceKind: palaceId != null ? 'palace' : null,
    persistKey: palaceId ? `palace_quiz:${palaceId}` : null,
  })
  const timerRef = useRef(timer)
  const hardUnloadRef = useRef(false)
  const generationStreamContentRef = useRef<HTMLPreElement | null>(null)
  const generationStreamAutoFollowRef = useRef(true)

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
  const filteredQuestions = useMemo(() => {
    if (questionScope === 'palace') {
      return questions.filter((question) => question.mini_palace_id == null)
    }
    if (questionScope.startsWith('mini:')) {
      const miniPalaceId = Number(questionScope.slice(5))
      return questions.filter((question) => question.mini_palace_id === miniPalaceId)
    }
    return questions
  }, [questionScope, questions])
  const currentQuestion = filteredQuestions[currentQuestionIndex] || null
  const rootQuestionCount = useMemo(
    () => questions.filter((question) => question.mini_palace_id == null).length,
    [questions],
  )
  const hasMiniPalaces = miniPalaces.length > 0
  const selectedSubjectDocument = useMemo(
    () =>
      pdfController.subjectDocuments.find(
        (document: SubjectDocumentSummary) =>
          document.id === pdfController.selectedSubjectDocumentId,
      ) || null,
    [pdfController.selectedSubjectDocumentId, pdfController.subjectDocuments],
  )

  const registerQuizActivity = (source: string) => {
    timer.registerActivity('practice_interaction', { source })
  }

  const emitQuizFeedback = (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => {
    dispatchGlobalFeedback(event, options)
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(QUIZ_VIEW_MODE_STORAGE_KEY, viewMode)
    }
  }, [viewMode])

  useEffect(() => {
    timer.setSceneActive?.(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    if (!generationLoading || !generationStreamPreviewText) return
    const content = generationStreamContentRef.current
    if (content && generationStreamAutoFollowRef.current) {
      content.scrollTop = content.scrollHeight
    }
  }, [generationLoading, generationStreamPreviewText])

  useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true
    }
    window.addEventListener('beforeunload', markHardUnload)
    window.addEventListener('pagehide', markHardUnload)
    return () => {
      window.removeEventListener('beforeunload', markHardUnload)
      window.removeEventListener('pagehide', markHardUnload)
    }
  }, [])

  useEffect(() => {
    return () => {
      const currentTimer = timerRef.current
      if (hardUnloadRef.current) return
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.leaveScene({ source: 'route_leave' })
      }
    }
  }, [])

  useEffect(() => {
    if (!palaceId) return
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'quiz')) return
    timer.start({ source: 'page_enter' })
  }, [isActive, palaceId, timer])

  useEffect(() => {
    if (!palaceId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [palaceResponse, quizResponse] = await Promise.all([
          getPalaceApi(palaceId),
          getPalaceQuizQuestionsApi(palaceId),
        ])
        if (cancelled) return
        setPalace(palaceResponse as PalaceQuizPageMeta)
        setQuestions(quizResponse.items || [])
      } catch (nextError) {
        if (cancelled) return
        setError(nextError instanceof Error ? nextError.message : '加载做题页失败。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [palaceId])

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
    setCurrentQuestionIndex((current) => {
      if (filteredQuestions.length === 0) return 0
      return Math.min(current, filteredQuestions.length - 1)
    })
  }, [filteredQuestions])

  useEffect(() => {
    if (questionScope === 'all' || questionScope === 'palace') return
    const miniPalaceId = Number(questionScope.slice(5))
    if (!miniPalaces.some((item) => item.id === miniPalaceId)) {
      setQuestionScope('all')
    }
  }, [miniPalaces, questionScope])

  const refreshQuestions = async () => {
    if (!palaceId) return
    registerQuizActivity('quiz_refresh')
    emitQuizFeedback('navigation', { label: '刷新题库' })
    const result = await getPalaceQuizQuestionsApi(palaceId)
    setQuestions(result.items || [])
  }

  const updateQuestionState = (
    questionId: number,
    updater: (current: QuizCardState) => QuizCardState,
  ) => {
    setQuestionStates((current) => ({
      ...current,
      [questionId]: updater(current[questionId] || {}),
    }))
  }

  const resetQuestionState = (questionId: number) => {
    setQuestionStates((current) => ({
      ...current,
      [questionId]: {
        shortAnswerText: '',
        shortAnswerSubmitted: false,
        aiFeedback: null,
        aiFeedbackLoading: false,
        selectedOptionId: null,
        choiceResolved: false,
        choiceCorrect: false,
      },
    }))
  }

  const handleResetQuestionState = (questionId: number) => {
    registerQuizActivity('question_reset')
    emitQuizFeedback('session_reset', { label: '重做' })
    resetQuestionState(questionId)
  }

  const handleChoiceSelect = (question: PalaceQuizQuestion, optionId: string) => {
    const currentState = questionStates[question.id]
    if (currentState?.choiceResolved) return
    registerQuizActivity('choice_select')
    const isCorrect = question.answer_payload.correct_option_id === optionId
    emitQuizFeedback(isCorrect ? 'save_success' : 'save_error', {
      label: isCorrect ? '答对' : '答错',
      screenPulse: isCorrect ? 'soft' : null,
    })
    updateQuestionState(question.id, (state) => ({
      ...state,
      selectedOptionId: optionId,
      choiceResolved: true,
      choiceCorrect: isCorrect,
    }))
    void recordPalaceQuizChoiceAttemptApi(question.id, optionId)
      .then((response) => {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? response.question : item)),
        )
        emitQuizFeedback('card_reveal', {
          label: isCorrect ? '揭晓' : '答案',
          screenPulse: null,
        })
      })
      .catch((nextError) => {
        emitQuizFeedback('save_error', { label: '统计失败' })
        toast.error(nextError instanceof Error ? nextError.message : '统计刷新失败。')
      })
  }

  const handleShortAnswerSubmit = (questionId: number) => {
    registerQuizActivity('short_answer_submit')
    emitQuizFeedback('text_commit', { label: '提交答案' })
    updateQuestionState(questionId, (state) => ({
      ...state,
      shortAnswerSubmitted: true,
      aiFeedback: null,
    }))
  }

  const handleShortAnswerFeedback = async (question: PalaceQuizQuestion) => {
    registerQuizActivity('short_answer_feedback')
    const state = questionStates[question.id] || {}
    const userAnswer = state.shortAnswerText?.trim() || ''
    if (!userAnswer) {
      emitQuizFeedback('save_error', { label: '先写答案' })
      toast.error('请先填写你的答案。')
      return
    }
    emitQuizFeedback('shortcut_trigger', { label: 'AI点评' })
    updateQuestionState(question.id, (current) => ({
      ...current,
      aiFeedbackLoading: true,
    }))
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'quiz_short_answer_feedback',
        entrypointKey: 'quiz-short-answer-feedback',
        title: '简答题 AI 点评配置',
      })
      if (!aiOptions) {
        updateQuestionState(question.id, (current) => ({
          ...current,
          aiFeedbackLoading: false,
        }))
        emitQuizFeedback('toggle_off', { label: '取消AI' })
        return
      }
      const feedback = await requestPalaceShortAnswerFeedbackApi(question.id, userAnswer, aiOptions)
      updateQuestionState(question.id, (current) => ({
        ...current,
        aiFeedback: feedback,
        aiFeedbackLoading: false,
      }))
      emitQuizFeedback('bilink_action', { label: 'AI完成' })
    } catch (nextError) {
      updateQuestionState(question.id, (current) => ({
        ...current,
        aiFeedbackLoading: false,
      }))
      emitQuizFeedback('save_error', { label: 'AI失败' })
      toast.error(nextError instanceof Error ? nextError.message : 'AI 点评失败。')
    }
  }

  const handleStartCreateQuestion = () => {
    registerQuizActivity('manage_create_start')
    emitQuizFeedback('node_create', { label: '新增题目' })
    setEditingQuestionId(null)
    setQuestionForm(buildEmptyQuestionForm())
  }

  const handleEditQuestion = (question: PalaceQuizQuestion) => {
    registerQuizActivity('manage_edit_question')
    emitQuizFeedback('node_edit_start', { label: '编辑题目' })
    setActiveTab('manage')
    setEditingQuestionId(question.id)
    setQuestionForm(buildQuestionFormFromQuestion(question))
  }

  const handleSaveQuestion = async () => {
    if (!palaceId) return
    registerQuizActivity('manage_save_question')
    emitQuizFeedback('field_commit', { label: editingQuestionId != null ? '更新题目' : '保存题目' })
    setManageSaving(true)
    try {
      const draft = buildDraftFromForm(questionForm)
      if (editingQuestionId != null) {
        await updatePalaceQuizQuestionApi(editingQuestionId, draft)
        toast.success('题目已更新')
      } else {
        await createPalaceQuizQuestionApi(palaceId, draft)
        toast.success('题目已新增')
      }
      emitQuizFeedback('save_success', {
        label: editingQuestionId != null ? '已更新' : '已新增',
      })
      await refreshQuestions()
      setEditingQuestionId(null)
      setQuestionForm(buildEmptyQuestionForm())
    } catch (nextError) {
      emitQuizFeedback('save_error', { label: '保存失败' })
      toast.error(nextError instanceof Error ? nextError.message : '保存题目失败。')
    } finally {
      setManageSaving(false)
    }
  }

  const handleDeleteQuestion = async (questionId: number) => {
    if (!window.confirm('确定删除这道题吗？')) return
    registerQuizActivity('manage_delete_question')
    emitQuizFeedback('node_delete', { label: '删除题目' })
    setManageDeletingId(questionId)
    try {
      await deletePalaceQuizQuestionApi(questionId)
      toast.success('题目已删除')
      emitQuizFeedback('save_success', { label: '已删除' })
      await refreshQuestions()
      setQuestionStates((current) => {
        const next = { ...current }
        delete next[questionId]
        return next
      })
      if (editingQuestionId === questionId) {
        setEditingQuestionId(null)
        setQuestionForm(buildEmptyQuestionForm())
      }
    } catch (nextError) {
      emitQuizFeedback('save_error', { label: '删除失败' })
      toast.error(nextError instanceof Error ? nextError.message : '删除题目失败。')
    } finally {
      setManageDeletingId(null)
    }
  }

  const handleImageFileChange = (fileList: FileList | null) => {
    registerQuizActivity('generation_select_files')
    emitQuizFeedback('drag_drop', { label: '选图片' })
    const nextFiles = Array.from(fileList || [])
    setGenerationFiles(
      generationSourceKind === 'image-single' ? nextFiles.slice(0, 1) : nextFiles,
    )
    setGenerationError('')
  }

  const handleAddCurrentPdfSource = () => {
    registerQuizActivity('generation_add_pdf_source')
    if (!pdfController.selectedSubjectDocumentId || !selectedSubjectDocument) {
      emitQuizFeedback('save_error', { label: '未选PDF' })
      setGenerationError('请先选择一份 PDF 资料。')
      return
    }
    if (pdfController.selectedPdfPages.length === 0) {
      emitQuizFeedback('save_error', { label: '未选页码' })
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
      if (existingIndex >= 0) {
        next[existingIndex] = nextSource
      } else {
        next.push(nextSource)
      }
      return next
    })
    emitQuizFeedback('node_create', { label: '加入PDF' })
    setGenerationError('')
  }

  const handleRemovePdfSource = (subjectDocumentId: number) => {
    registerQuizActivity('generation_remove_pdf_source')
    emitQuizFeedback('node_delete', { label: '移除PDF' })
    setGenerationPdfSources((current) =>
      current.filter((item) => item.subject_document_id !== subjectDocumentId),
    )
    setGenerationError('')
  }

  const handlePdfSourceRoleHintChange = (
    subjectDocumentId: number,
    value: PalaceQuizPdfSourceRole,
  ) => {
    emitQuizFeedback('toggle_on', { label: value === 'answer' ? '设为答案' : '设为题目' })
    setGenerationPdfSources((current) =>
      current.map((item) =>
        item.subject_document_id === subjectDocumentId ? { ...item, role_hint: value } : item,
      ),
    )
  }

  const handleGenerationStreamScroll = () => {
    const content = generationStreamContentRef.current
    if (!content) return
    const remaining = content.scrollHeight - content.scrollTop - content.clientHeight
    generationStreamAutoFollowRef.current = remaining <= 32
  }

  const handleGeneratePreview = async () => {
    if (!palaceId) return
    registerQuizActivity('generation_preview')
    emitQuizFeedback('shortcut_trigger', { label: '生成预览' })
    setGenerationLoading(true)
    setGenerationError('')
    setGenerationPreview(null)
    setGenerationStreamStatus('')
    setGenerationStreamStepLabel('')
    setGenerationStreamPreviewText('')
    generationStreamAutoFollowRef.current = true
    try {
      if (generationClassifyByMiniPalace && miniPalaces.length === 0) {
        emitQuizFeedback('save_error', { label: '无小宫殿' })
        throw new Error('当前宫殿还没有小宫殿，无法按小宫殿分类保存。')
      }
      const aiOptions = await promptForAiOptions({
        scenarioKey: generationSourceKind === 'subject-pdf' ? 'quiz_pdf_generation' : 'quiz_image_generation',
        entrypointKey:
          generationSourceKind === 'subject-pdf'
            ? 'quiz-generate-pdf'
            : generationSourceKind === 'image-batch'
              ? 'quiz-generate-images-batch'
              : 'quiz-generate-images-single',
        title:
          generationSourceKind === 'subject-pdf'
            ? 'PDF 做题生成配置'
            : '图片做题生成配置',
      })
      if (!aiOptions) {
        emitQuizFeedback('toggle_off', { label: '取消生成' })
        setGenerationLoading(false)
        return
      }
      if (generationSourceKind === 'subject-pdf') {
        if (generationPdfSources.length === 0) {
          emitQuizFeedback('save_error', { label: '未加PDF' })
          throw new Error('请先把至少一份 PDF 加入资料列表。')
        }
        const preview = await previewPalaceQuizGenerationFromPdfStreamApi(palaceId, {
          subject_document_id: generationPdfSources[0]?.subject_document_id,
          page_selection: generationPdfSources[0]?.page_selection || [],
          pdf_sources: generationPdfSources.map((item) => ({
            subject_document_id: item.subject_document_id,
            page_selection: item.page_selection,
            role_hint: item.role_hint,
          })),
          extra_prompt: pdfController.rangePrompt,
          classify_by_mini_palace: generationClassifyByMiniPalace,
          ai_options: aiOptions,
        }, {
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
        setGenerationStreamStatus('题目预览已生成')
        emitQuizFeedback('card_reveal', {
          label: generationClassifyByMiniPalace ? '分组预览' : '题目预览',
        })
        generationPdfSources.forEach((item) => {
          pdfController.persistAnalyzedPdfPages(item.subject_document_id, item.page_selection)
        })
      } else {
        if (generationFiles.length === 0) {
          emitQuizFeedback('save_error', { label: '未选图片' })
          throw new Error('请先上传图片。')
        }
        const preview = await previewPalaceQuizGenerationFromImagesApi(
          palaceId,
          generationFiles,
          pdfController.rangePrompt,
          generationClassifyByMiniPalace,
          aiOptions,
        )
        setGenerationPreview(preview)
        emitQuizFeedback('card_reveal', { label: '图片预览' })
      }
    } catch (nextError) {
      emitQuizFeedback('save_error', { label: '生成失败' })
      setGenerationError(
        nextError instanceof Error ? nextError.message : '生成题目预览失败。',
      )
    } finally {
      setGenerationLoading(false)
    }
  }

  const handleSaveGenerationPreview = async () => {
    if (!palaceId || !generationPreview || generationPreview.questions.length === 0) return
    registerQuizActivity('generation_save_preview')
    emitQuizFeedback('import_apply', { label: '写入题库' })
    setGenerationSaving(true)
    try {
      const groupedPreview = generationPreview.grouped_questions
      const questionsToSave = groupedPreview
        ? [
            ...groupedPreview.mini_palace_groups.flatMap((group) => group.questions),
            ...groupedPreview.unassigned_questions.map((question) => ({
              ...question,
              mini_palace_id: null,
            })),
          ]
        : generationPreview.questions
      await batchCreatePalaceQuizQuestionsApi(palaceId, questionsToSave)
      toast.success('题目已保存到题库')
      emitQuizFeedback('save_success', { label: '已入题库' })
      await refreshQuestions()
      setGenerationPreview(null)
      setActiveTab('practice')
    } catch (nextError) {
      emitQuizFeedback('save_error', { label: '写入失败' })
      toast.error(nextError instanceof Error ? nextError.message : '保存 AI 题目失败。')
    } finally {
      setGenerationSaving(false)
    }
  }

  const handleClassifyExistingQuestions = async () => {
    if (!palaceId) return
    registerQuizActivity('generation_classify_existing_to_mini_palaces')
    emitQuizFeedback('segment_action', { label: '归类题库' })
    setClassificationLoading(true)
    setClassificationResult(null)
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'quiz_mini_palace_grouping',
        entrypointKey: 'quiz-classify-existing-mini-palace',
        title: '已有题库归类配置',
      })
      if (!aiOptions) {
        emitQuizFeedback('toggle_off', { label: '取消归类' })
        setClassificationLoading(false)
        return
      }
      const result = await classifyPalaceQuizQuestionsToMiniPalacesApi(palaceId, aiOptions)
      setClassificationResult(result)
      toast.success('已有题库已按小宫殿归类')
      emitQuizFeedback('all_clear_ready', { label: '归类完成' })
      await refreshQuestions()
    } catch (nextError) {
      emitQuizFeedback('save_error', { label: '归类失败' })
      toast.error(nextError instanceof Error ? nextError.message : '归类小宫殿题库失败。')
    } finally {
      setClassificationLoading(false)
    }
  }

  const pageTabs: Array<{ key: PalaceQuizTabKey; label: string }> = [
    { key: 'practice', label: '做题' },
    { key: 'manage', label: '管理' },
    { key: 'generate', label: 'AI生成' },
  ]

  if (!palaceId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        宫殿不存在。
      </div>
    )
  }

  return (
    <div
      className="space-y-5"
      onClickCapture={() => registerQuizActivity('page_click')}
      onKeyDownCapture={() => registerQuizActivity('page_keydown')}
      onChangeCapture={() => registerQuizActivity('page_change')}
    >
      {aiRunConfigDialog}
      <PageIntro
        eyebrow="宫殿做题"
        title={palace?.title ? `${palace.title} · 配套习题` : '宫殿配套习题'}
        description="这里把宫殿级题库、手动管理和 AI 预览生成放在一起。选择题即时判题并累计统计，简答题提交后显示参考答案与解析。"
        actions={
          <>
            <Link to={`/palaces/${palaceId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                返回宫殿
              </Button>
            </Link>
            <Badge variant="secondary">{questions.length} 题</Badge>
          </>
        }
      />

      <SessionTimerBar
        effectiveSeconds={timer.effectiveSeconds}
        idleSeconds={timer.idleSeconds}
        automationScene="quiz"
        pauseCount={timer.pauseCount}
        status={timer.status}
        onStart={() => timer.start({ source: 'manual' })}
        onPause={() => timer.pause({ source: 'manual' })}
        onResume={() => timer.resume({ source: 'manual' })}
        onAdjustDuration={timer.adjustDuration}
        showCompleteAction={false}
        showRestartAction={false}
        layout="compact"
      />

      <div className="flex flex-wrap gap-2">
        {pageTabs.map((tab) => (
            <Button
              key={tab.key}
              type="button"
              variant={activeTab === tab.key ? 'default' : 'outline'}
              onClick={() => {
                registerQuizActivity(`tab_${tab.key}`)
                emitQuizFeedback('mode_switch', { label: tab.label })
                setActiveTab(tab.key)
              }}
            >
            {tab.label}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          正在加载题库...
        </div>
      ) : null}

      {!loading && activeTab === 'practice' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={viewMode === 'single' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                registerQuizActivity('view_mode_single')
                emitQuizFeedback('mode_switch', { label: '逐题模式' })
                setViewMode('single')
              }}
            >
              逐题模式
            </Button>
            <Button
              type="button"
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                registerQuizActivity('view_mode_list')
                emitQuizFeedback('mode_switch', { label: '整页列表' })
                setViewMode('list')
              }}
            >
              整页列表
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={questionScope === 'all' ? 'default' : 'outline'}
              onClick={() => {
                emitQuizFeedback('segment_action', { label: '全部题目' })
                setQuestionScope('all')
              }}
            >
              全部
            </Button>
            <Button
              type="button"
              size="sm"
              variant={questionScope === 'palace' ? 'default' : 'outline'}
              onClick={() => {
                emitQuizFeedback('segment_action', { label: '大宫殿' })
                setQuestionScope('palace')
              }}
            >
              大宫殿
              <Badge variant="secondary" className="ml-2">
                {rootQuestionCount}
              </Badge>
            </Button>
            {miniPalaces.map((miniPalace) => (
              <Button
                key={miniPalace.id}
                type="button"
                size="sm"
                variant={questionScope === `mini:${miniPalace.id}` ? 'default' : 'outline'}
                onClick={() => {
                  emitQuizFeedback('segment_action', { label: miniPalace.name })
                  setQuestionScope(`mini:${miniPalace.id}`)
                }}
              >
                {miniPalace.name}
                <Badge variant="secondary" className="ml-2">
                  {questions.filter((question) => question.mini_palace_id === miniPalace.id).length}
                </Badge>
              </Button>
            ))}
          </div>

          {filteredQuestions.length === 0 ? (
            <Card className="border-border/70 bg-card/92">
              <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
                {questions.length === 0
                  ? '这个宫殿还没有题目，先去“管理”手动新增，或者到“AI生成”里预览后保存。'
                  : '当前范围下还没有题目。'}
              </CardContent>
            </Card>
          ) : viewMode === 'single' && currentQuestion ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/90 px-4 py-3 text-sm">
                <div>
                  第 {currentQuestionIndex + 1} / {filteredQuestions.length} 题
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={currentQuestionIndex <= 0}
                    onClick={() => {
                      registerQuizActivity('question_prev')
                      emitQuizFeedback('navigation', { label: '上一题' })
                      setCurrentQuestionIndex((current) => Math.max(current - 1, 0))
                    }}
                  >
                    上一题
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={currentQuestionIndex >= filteredQuestions.length - 1}
                    onClick={() => {
                      registerQuizActivity('question_next')
                      emitQuizFeedback('navigation', { label: '下一题' })
                      setCurrentQuestionIndex((current) =>
                        Math.min(current + 1, filteredQuestions.length - 1),
                      )
                    }}
                  >
                    下一题
                  </Button>
                </div>
              </div>
              <QuizQuestionCard
                question={currentQuestion}
                state={questionStates[currentQuestion.id]}
                onChoiceSelect={handleChoiceSelect}
                onStateChange={updateQuestionState}
                onShortAnswerSubmit={handleShortAnswerSubmit}
                onShortAnswerFeedback={handleShortAnswerFeedback}
                onReset={handleResetQuestionState}
                onEdit={handleEditQuestion}
              />
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredQuestions.map((question) => (
                <QuizQuestionCard
                  key={question.id}
                  question={question}
                  state={questionStates[question.id]}
                  compact
                  onChoiceSelect={handleChoiceSelect}
                  onStateChange={updateQuestionState}
                  onShortAnswerSubmit={handleShortAnswerSubmit}
                  onShortAnswerFeedback={handleShortAnswerFeedback}
                  onReset={handleResetQuestionState}
                  onEdit={handleEditQuestion}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!loading && activeTab === 'manage' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_380px]">
          <Card className="border-border/70 bg-card/92">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">题库列表</CardTitle>
              <Button type="button" size="sm" onClick={handleStartCreateQuestion}>
                <Plus className="h-4 w-4" />
                新增题目
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={questionScope === 'all' ? 'default' : 'outline'}
                  onClick={() => {
                    emitQuizFeedback('segment_action', { label: '全部题目' })
                    setQuestionScope('all')
                  }}
                >
                  全部
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={questionScope === 'palace' ? 'default' : 'outline'}
                  onClick={() => {
                    emitQuizFeedback('segment_action', { label: '大宫殿' })
                    setQuestionScope('palace')
                  }}
                >
                  大宫殿
                </Button>
                {miniPalaces.map((miniPalace) => (
                  <Button
                    key={miniPalace.id}
                    type="button"
                    size="sm"
                    variant={questionScope === `mini:${miniPalace.id}` ? 'default' : 'outline'}
                    onClick={() => {
                      emitQuizFeedback('segment_action', { label: miniPalace.name })
                      setQuestionScope(`mini:${miniPalace.id}`)
                    }}
                  >
                    {miniPalace.name}
                  </Button>
                ))}
              </div>
              {filteredQuestions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                  {questions.length === 0
                    ? '还没有题目，可以先在右侧手动新增，或者去 AI生成 标签里先预览后保存。'
                    : '当前范围下还没有题目。'}
                </div>
              ) : (
                <div className="grid gap-2 xl:grid-cols-2">
                  {filteredQuestions.map((question, index) => (
                    <div
                      key={question.id}
                      className={cn(
                        'rounded-xl border px-3 py-3',
                        editingQuestionId === question.id
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border/70 bg-background/70',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">#{index + 1}</Badge>
                            <Badge variant="outline">
                              {question.question_type === 'multiple_choice' ? '选择题' : '简答题'}
                            </Badge>
                            <Badge variant={question.mini_palace_id == null ? 'secondary' : 'outline'}>
                              {getQuestionOwnershipLabel(question)}
                            </Badge>
                          </div>
                          <div className="line-clamp-3 text-sm font-medium leading-6">
                            {question.stem}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <QuestionSourceBadge sourceMeta={question.source_meta} compact />
                            {question.question_type === 'multiple_choice' ? (
                              <span className="text-[11px] text-muted-foreground">
                                对 {question.correct_count} / 错 {question.incorrect_count}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5"
                            onClick={() => handleEditQuestion(question)}
                          >
                            编辑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5"
                            disabled={manageDeletingId === question.id}
                            onClick={() => void handleDeleteQuestion(question.id)}
                          >
                            {manageDeletingId === question.id ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/92">
            <CardHeader>
              <CardTitle className="text-base">
                {editingQuestionId != null ? '编辑题目' : '新增题目'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <span className="text-sm font-medium">题型</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={questionForm.question_type === 'multiple_choice' ? 'default' : 'outline'}
                    onClick={() =>
                      setQuestionForm((current) => ({
                        ...current,
                        question_type: 'multiple_choice',
                      }))
                    }
                  >
                    选择题
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={questionForm.question_type === 'short_answer' ? 'default' : 'outline'}
                    onClick={() =>
                      setQuestionForm((current) => ({
                        ...current,
                        question_type: 'short_answer',
                      }))
                    }
                  >
                    简答题
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <span className="text-sm font-medium">题干</span>
                <Textarea
                  value={questionForm.stem}
                  onChange={(event) =>
                    setQuestionForm((current) => ({
                      ...current,
                      stem: event.target.value,
                    }))
                  }
                  placeholder="输入题干"
                  rows={4}
                />
              </div>

              {questionForm.question_type === 'multiple_choice' ? (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">选项</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setQuestionForm((current) => ({
                          ...current,
                          options: [
                            ...current.options,
                            {
                              id: String.fromCharCode(65 + current.options.length),
                              text: '',
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="h-4 w-4" />
                      增加选项
                    </Button>
                  </div>
                  {questionForm.options.map((option, index) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <div className="w-8 text-sm font-medium text-muted-foreground">
                        {option.id}
                      </div>
                      <Input
                        value={option.text}
                        onChange={(event) =>
                          setQuestionForm((current) => ({
                            ...current,
                            options: current.options.map((item, optionIndex) =>
                              optionIndex === index
                                ? { ...item, text: event.target.value }
                                : item,
                            ),
                          }))
                        }
                        placeholder={`选项 ${option.id}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={questionForm.options.length <= 2}
                        onClick={() =>
                          setQuestionForm((current) => {
                            const nextOptions = current.options.filter(
                              (_, optionIndex) => optionIndex !== index,
                            )
                            const nextCorrect = nextOptions.some(
                              (item) => item.id === current.correct_option_id,
                            )
                              ? current.correct_option_id
                              : nextOptions[0]?.id || 'A'
                            return {
                              ...current,
                              options: nextOptions,
                              correct_option_id: nextCorrect,
                            }
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">正确选项</span>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      value={questionForm.correct_option_id}
                      onChange={(event) =>
                        setQuestionForm((current) => ({
                          ...current,
                          correct_option_id: event.target.value,
                        }))
                      }
                    >
                      {questionForm.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  <span className="text-sm font-medium">参考答案</span>
                  <Textarea
                    value={questionForm.reference_answer}
                    onChange={(event) =>
                      setQuestionForm((current) => ({
                        ...current,
                        reference_answer: event.target.value,
                      }))
                    }
                    placeholder="输入参考答案"
                    rows={4}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <span className="text-sm font-medium">解析</span>
                <Textarea
                  value={questionForm.analysis}
                  onChange={(event) =>
                    setQuestionForm((current) => ({
                      ...current,
                      analysis: event.target.value,
                    }))
                  }
                  placeholder="输入解析"
                  rows={5}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={manageSaving} onClick={() => void handleSaveQuestion()}>
                  {manageSaving ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  保存题目
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingQuestionId(null)
                    setQuestionForm(buildEmptyQuestionForm())
                  }}
                >
                  重置表单
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!loading && activeTab === 'generate' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_420px]">
          <div className="space-y-4">
            {hasMiniPalaces && rootQuestionCount > 0 ? (
              <Card className="border-border/70 bg-card/92">
                <CardHeader>
                  <CardTitle className="text-base">已有题库归类到小宫殿</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                    当前有 {rootQuestionCount} 道大宫殿题、{miniPalaces.length} 个小宫殿。这里会调用
                    “小宫殿归类”场景会判断哪些题同时属于哪些小宫殿，并复制写入对应小宫殿题库。
                  </div>
                    {classificationResult ? (
                      <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
                        <div>本次写入 {classificationResult.copied_question_count} 道小宫殿题。</div>
                        {classificationResult.resolved_ai?.model_label ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            实际模型：{classificationResult.resolved_ai.model_label}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {classificationResult.mini_palace_groups.map((group) => (
                          <Badge key={group.mini_palace_id} variant="outline">
                            {group.mini_palace_name}：{group.question_count}
                          </Badge>
                        ))}
                        <Badge variant="secondary">未归类 {classificationResult.unassigned_count}</Badge>
                        {classificationResult.ai_call_log_id ? (
                          <Badge variant="outline">
                            AI日志 {classificationResult.ai_call_log_id}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    disabled={classificationLoading}
                    onClick={() => void handleClassifyExistingQuestions()}
                  >
                    {classificationLoading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    归类已有题库
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-border/70 bg-card/92">
              <CardHeader>
                <CardTitle className="text-base">来源设置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={generationSourceKind === 'subject-pdf' ? 'default' : 'outline'}
                    onClick={() => {
                      setGenerationSourceKind('subject-pdf')
                      setGenerationError('')
                    }}
                  >
                    <FileText className="h-4 w-4" />
                    学科 PDF
                  </Button>
                  <Button
                    type="button"
                    variant={generationSourceKind === 'image-single' ? 'default' : 'outline'}
                    onClick={() => {
                      setGenerationSourceKind('image-single')
                      setGenerationFiles((current) => current.slice(0, 1))
                      setGenerationError('')
                    }}
                  >
                    <ImagePlus className="h-4 w-4" />
                    单图
                  </Button>
                  <Button
                    type="button"
                    variant={generationSourceKind === 'image-batch' ? 'default' : 'outline'}
                    onClick={() => {
                      setGenerationSourceKind('image-batch')
                      setGenerationError('')
                    }}
                  >
                    <Sparkles className="h-4 w-4" />
                    多图
                  </Button>
                </div>

                {generationSourceKind === 'subject-pdf' ? (
                  <div className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">学科</span>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={pdfController.selectedSubjectId ?? ''}
                          onChange={(event) =>
                            pdfController.setSelectedSubjectId(
                              event.target.value ? Number(event.target.value) : null,
                            )
                          }
                          disabled={subjectsLoading}
                        >
                          <option value="">请选择学科</option>
                          {subjectOptions.map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">PDF 资料</span>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={pdfController.selectedSubjectDocumentId ?? ''}
                          onChange={(event) =>
                            pdfController.setSelectedSubjectDocumentId(
                              event.target.value ? Number(event.target.value) : null,
                            )
                          }
                          disabled={!pdfController.selectedSubjectId || pdfController.subjectDocumentsLoading}
                        >
                          <option value="">请选择 PDF</option>
                          {pdfController.subjectDocuments.map((document: SubjectDocumentSummary) => (
                            <option key={document.id} value={document.id}>
                              {document.original_name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent">
                        <Plus className="h-4 w-4" />
                        上传新 PDF 到资料库
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (!file) return
                            void uploadSubjectDocumentApi(pdfController.selectedSubjectId || 0, file)
                              .then(async () => {
                                toast.success('PDF 已上传到资料库')
                                await pdfController.refreshSubjectDocuments()
                              })
                              .catch((nextError) => {
                                toast.error(
                                  nextError instanceof Error
                                    ? nextError.message
                                    : 'PDF 上传失败。',
                                )
                              })
                              .finally(() => {
                                event.currentTarget.value = ''
                              })
                          }}
                          disabled={!pdfController.selectedSubjectId}
                        />
                      </label>
                      <Button type="button" variant="outline" onClick={handleAddCurrentPdfSource}>
                        <Plus className="h-4 w-4" />
                        加入本次资料集
                      </Button>
                    </div>

                    <div className="grid gap-2">
                      <span className="text-sm font-medium">页码范围</span>
                      <Input
                        value={pdfController.pdfPageInput}
                        onChange={(event) => pdfController.setPdfPageInput(event.target.value)}
                        placeholder="例如：3,4,8-10"
                      />
                      {pdfController.pdfSelectionError ? (
                        <div className="text-xs text-destructive">{pdfController.pdfSelectionError}</div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          已选择 {pdfController.selectedPdfPages.length} 页
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                      PDF 页面预览已关闭。请直接输入页码范围，例如 15,16,17 或 15-17。
                    </div>

                    <div className="space-y-3 rounded-2xl border border-border/70 bg-background/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">本次已加入的 PDF 资料</div>
                        <div className="text-xs text-muted-foreground">
                          共 {generationPdfSources.length} 份
                        </div>
                      </div>
                      {generationPdfSources.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          先选中一份 PDF 和页码，再点“加入本次资料集”。可以把题目、答案、解析分开加入。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {generationPdfSources.map((source) => (
                            <div
                              key={source.subject_document_id}
                              className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <div className="text-sm font-medium">{source.document_name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    页码：{source.page_selection.join(', ')}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleRemovePdfSource(source.subject_document_id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  移除
                                </Button>
                              </div>
                              <div className="mt-3 grid gap-2">
                                <span className="text-xs font-medium text-muted-foreground">
                                  资料角色
                                </span>
                                <select
                                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                  value={source.role_hint}
                                  onChange={(event) =>
                                    handlePdfSourceRoleHintChange(
                                      source.subject_document_id,
                                      event.target.value as PalaceQuizPdfSourceRole,
                                    )
                                  }
                                >
                                  <option value="question">题目</option>
                                  <option value="answer">答案</option>
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4">
                    <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background px-4 py-6 text-sm text-muted-foreground hover:text-foreground">
                      <ImagePlus className="mr-2 h-4 w-4" />
                      {generationSourceKind === 'image-single'
                        ? '上传单张图片'
                        : '上传多张图片'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple={generationSourceKind === 'image-batch'}
                        className="hidden"
                        onChange={(event) => handleImageFileChange(event.target.files)}
                      />
                    </label>
                    {generationFiles.length > 0 ? (
                      <div className="space-y-2">
                        {generationFiles.map((file) => (
                          <div
                            key={`${file.name}_${file.size}`}
                            className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm"
                          >
                            {file.name}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">还没有图片。</div>
                    )}
                  </div>
                )}

                <div className="grid gap-2">
                  <span className="text-sm font-medium">额外提示词</span>
                  <Textarea
                    value={pdfController.rangePrompt}
                    onChange={(event) => pdfController.setRangePrompt(event.target.value)}
                    placeholder="这里会与系统模板自动拼接，而不是覆盖。你可以补充题型偏好、难度要求、重点页码等。"
                    rows={4}
                  />
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={generationClassifyByMiniPalace}
                    onChange={(event) =>
                      setGenerationClassifyByMiniPalace(event.target.checked)
                    }
                    disabled={!hasMiniPalaces}
                  />
                    <span>
                    <span className="font-medium">生成时按小宫殿分类保存</span>
                    <span className="mt-1 block text-muted-foreground">
                      {hasMiniPalaces
                        ? '开启后，题目会先按当前出题模型生成，再调用“小宫殿归类”场景做分组返回，保存时自动分宫殿入库。'
                        : '当前宫殿还没有小宫殿，暂时无法开启这个选项。'}
                    </span>
                  </span>
                </label>

                {generationError ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {generationError}
                  </div>
                ) : null}

                <Button
                  type="button"
                  disabled={generationLoading}
                  onClick={() => void handleGeneratePreview()}
                >
                  {generationLoading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Brain className="h-4 w-4" />
                  )}
                  生成预览
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/70 bg-card/92">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">预览后保存</CardTitle>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {generationPreview ? (
                  <span className="text-xs text-muted-foreground">
                    将保存 {getGenerationPreviewSaveCount(generationPreview)} 题
                  </span>
                ) : null}
                <Button
                  type="button"
                  disabled={!generationPreview || generationSaving}
                  onClick={() => void handleSaveGenerationPreview()}
                >
                  {generationSaving ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  保存到题库
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {generationLoading || generationStreamStatus || generationStreamPreviewText ? (
                <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">实时模型输出</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {generationStreamStepLabel ? (
                        <Badge variant="outline">{generationStreamStepLabel}</Badge>
                      ) : null}
                      <span>{generationStreamStatus || '等待生成'}</span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'rounded-2xl border border-border/70 bg-background p-3',
                      !generationStreamPreviewText &&
                        'flex min-h-[160px] items-center justify-center text-sm text-muted-foreground',
                    )}
                  >
                    {generationStreamPreviewText ? (
                      <pre
                        ref={generationStreamContentRef}
                        onScroll={handleGenerationStreamScroll}
                        data-testid="palace-quiz-generation-stream-preview"
                        className="max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground"
                      >
                        {generationStreamPreviewText}
                      </pre>
                    ) : (
                      '点击生成后，这里会持续显示模型原始输出。'
                    )}
                  </div>
                </div>
              ) : null}

              {!generationPreview ? (
                <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                  先生成预览，这里会显示 AI 返回的题目草稿。确认后再批量写入题库。
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                    来源：{generationPreview.source_meta.source_kind} · 模式：
                    {generationPreview.source_meta.generation_mode}
                    {generationPreview.resolved_ai?.model_label ? (
                      <span> · 实际模型 {generationPreview.resolved_ai.model_label}</span>
                    ) : null}
                    {generationPreview.generation_stats ? (
                      <span>
                        {' '}
                        · AI返回 {generationPreview.generation_stats.returned_count} 题，可保存{' '}
                        {generationPreview.generation_stats.savable_count} 题，跳过{' '}
                        {generationPreview.generation_stats.skipped_count} 题
                      </span>
                    ) : (
                      <span> · 可保存 {getGenerationPreviewSaveCount(generationPreview)} 题</span>
                    )}
                    {generationPreview.ai_call_log_id ? (
                      <span> · AI日志 {generationPreview.ai_call_log_id}</span>
                    ) : null}
                    {generationPreview.source_meta.pdf_sources?.length ? (
                      <div className="mt-2 space-y-1">
                        {generationPreview.source_meta.pdf_sources.map(
                          (source: PalaceQuizPdfSourceMeta, index: number) => (
                            <div key={`${source.subject_document_id ?? 'pdf'}_${index}`}>
                              {index + 1}. {source.document_name || `PDF ${index + 1}`}
                              {source.page_numbers?.length
                                ? ` · 页码 ${source.page_numbers.join(', ')}`
                                : ''}
                              {source.role_hint
                                ? ` · 角色 ${source.role_hint === 'answer' ? '答案' : '题目'}`
                                : ''}
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                  {generationPreview.warnings?.length ? (
                    <div className="rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                      {generationPreview.warnings.join('；')}
                    </div>
                  ) : null}

                  {generationPreview.grouped_questions ? (
                    <div className="space-y-4">
                      {generationPreview.grouped_questions.mini_palace_groups.map((group) => (
                        <div key={group.mini_palace_id} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{group.mini_palace_name}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {group.questions.length} 题
                            </span>
                          </div>
                          {group.questions.map((question, index) => (
                            <PreviewQuestionCard
                              key={`${group.mini_palace_id}_${index}_${question.stem}`}
                              question={question}
                              index={index}
                            />
                          ))}
                        </div>
                      ))}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">未归类，仍保存到大宫殿</Badge>
                          <span className="text-xs text-muted-foreground">
                            {generationPreview.grouped_questions.unassigned_questions.length} 题
                          </span>
                        </div>
                        {generationPreview.grouped_questions.unassigned_questions.map(
                          (question, index) => (
                            <PreviewQuestionCard
                              key={`unassigned_${index}_${question.stem}`}
                              question={question}
                              index={index}
                            />
                          ),
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {generationPreview.questions.map((question, index) => (
                        <PreviewQuestionCard
                          key={`${question.question_type}_${index}_${question.stem}`}
                          question={question}
                          index={index}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

interface QuizQuestionCardProps {
  question: PalaceQuizQuestion
  state: QuizCardState | undefined
  compact?: boolean
  onChoiceSelect: (question: PalaceQuizQuestion, optionId: string) => void
  onStateChange: (
    questionId: number,
    updater: (current: QuizCardState) => QuizCardState,
  ) => void
  onShortAnswerSubmit: (questionId: number) => void
  onShortAnswerFeedback: (question: PalaceQuizQuestion) => void
  onReset: (questionId: number) => void
  onEdit: (question: PalaceQuizQuestion) => void
}

function PreviewQuestionCard({
  question,
  index,
}: {
  question: PalaceQuizQuestionDraft
  index: number
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge variant="secondary">#{index + 1}</Badge>
        <Badge variant="outline">
          {question.question_type === 'multiple_choice' ? '选择题' : '简答题'}
        </Badge>
      </div>
      <div className="text-sm font-medium leading-6">{question.stem}</div>
      {question.question_type === 'multiple_choice' ? (
        <div className="mt-2.5 space-y-1.5">
          {question.options.map((option) => (
            <div
              key={option.id}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-sm',
                option.id === question.answer_payload.correct_option_id
                  ? 'border-success/30 bg-success/5 text-success'
                  : 'border-border/70 bg-background',
              )}
            >
              {option.id}. {option.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2.5 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
          参考答案：{question.answer_payload.reference_answer || '暂无'}
        </div>
      )}
      <div className="mt-2.5 text-sm text-muted-foreground">
        解析：{question.analysis || '暂无解析'}
      </div>
    </div>
  )
}

function QuizQuestionCard({
  question,
  state,
  compact = false,
  onChoiceSelect,
  onStateChange,
  onShortAnswerSubmit,
  onShortAnswerFeedback,
  onReset,
  onEdit,
}: QuizQuestionCardProps) {
  const shortAnswerSubmitted = Boolean(state?.shortAnswerSubmitted)

  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader
        className={cn(
          'flex flex-row items-start justify-between gap-3',
          compact ? 'px-4 py-4' : '',
        )}
      >
        <div className={cn(compact ? 'space-y-1.5' : 'space-y-2')}>
          <div className={cn('flex flex-wrap items-center', compact ? 'gap-1.5' : 'gap-2')}>
            <Badge variant="outline">
              {question.question_type === 'multiple_choice' ? '选择题' : '简答题'}
            </Badge>
            <Badge variant={question.mini_palace_id == null ? 'secondary' : 'outline'}>
              {getQuestionOwnershipLabel(question)}
            </Badge>
            <QuestionSourceBadge sourceMeta={question.source_meta} compact={compact} />
            {question.question_type === 'multiple_choice' ? (
              <span className={cn('text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
                答对 {question.correct_count} 次 / 答错 {question.incorrect_count} 次
              </span>
            ) : null}
          </div>
          <CardTitle className={cn(compact ? 'text-sm leading-6' : 'text-base leading-7')}>
            {question.stem}
          </CardTitle>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={compact ? 'h-8 px-2.5' : ''}
          onClick={() => onEdit(question)}
        >
          编辑
        </Button>
      </CardHeader>
      <CardContent className={cn(compact ? 'space-y-3 px-4 pb-4 pt-0' : 'space-y-4')}>
        {question.question_type === 'multiple_choice' ? (
          <>
            <div className={cn('grid', compact ? 'gap-2' : 'gap-3')}>
              {(question.options || []).map((option) => {
                const tone = getOptionTone(question, state, option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      'border text-left text-sm transition-colors',
                      compact ? 'rounded-xl px-3 py-2' : 'rounded-2xl px-4 py-3',
                      tone === 'correct' && 'border-success/30 bg-success/5 text-success',
                      tone === 'incorrect' && 'border-destructive/30 bg-destructive/5 text-destructive',
                      tone === 'idle' && state?.choiceResolved && 'border-border/70 bg-background/60 text-muted-foreground',
                      !state?.choiceResolved && 'border-border/70 bg-background/80 hover:border-primary/40 hover:bg-primary/5',
                    )}
                    onClick={() => onChoiceSelect(question, option.id)}
                    disabled={state?.choiceResolved}
                  >
                    <span className="font-medium">{option.id}.</span> {option.text}
                  </button>
                )
              })}
            </div>

            {state?.choiceResolved ? (
              <div
                className={cn(
                  'border border-border/70 bg-background/70',
                  compact ? 'rounded-xl px-3 py-3' : 'rounded-2xl px-4 py-4',
                )}
              >
                <div className="text-sm font-medium">
                  {state.choiceCorrect ? '回答正确' : '回答错误'}
                </div>
                <div className={cn('text-sm text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
                  正确答案：{question.answer_payload.correct_option_id || '暂无'}
                </div>
                <div className={cn('text-sm', compact ? 'mt-2' : 'mt-3')}>
                  解析：{question.analysis || '暂无解析'}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid gap-2">
              <span className="text-sm font-medium">你的答案</span>
              <Textarea
                value={state?.shortAnswerText || ''}
                onChange={(event) =>
                  onStateChange(question.id, (current) => ({
                    ...current,
                    shortAnswerText: event.target.value,
                  }))
                }
                rows={compact ? 4 : 5}
                placeholder="先写下你的答案，再点击提交"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => onShortAnswerSubmit(question.id)}>
                提交答案
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!shortAnswerSubmitted || state?.aiFeedbackLoading}
                onClick={() => onShortAnswerFeedback(question)}
              >
                {state?.aiFeedbackLoading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                AI点评
              </Button>
            </div>
            {shortAnswerSubmitted ? (
              <div
                className={cn(
                  'border border-border/70 bg-background/70 text-sm',
                  compact ? 'rounded-xl px-3 py-3' : 'rounded-2xl px-4 py-4',
                )}
              >
                <div className="font-medium">参考答案</div>
                <div
                  className={cn(
                    'whitespace-pre-wrap text-muted-foreground',
                    compact ? 'mt-1.5' : 'mt-2',
                  )}
                >
                  {question.answer_payload.reference_answer || '暂无参考答案'}
                </div>
                <div className={cn('font-medium', compact ? 'mt-3' : 'mt-4')}>解析</div>
                <div
                  className={cn(
                    'whitespace-pre-wrap text-muted-foreground',
                    compact ? 'mt-1.5' : 'mt-2',
                  )}
                >
                  {question.analysis || '暂无解析'}
                </div>
                {state?.aiFeedback ? (
                  <div
                    className={cn(
                      'rounded-xl border border-primary/20 bg-primary/5 px-3 py-3',
                      compact ? 'mt-3' : 'mt-4',
                    )}
                  >
                    <div className="mb-2 text-sm font-medium">AI点评</div>
                    {state.aiFeedback.resolved_ai?.model_label ? (
                      <div className="mb-2 text-xs text-muted-foreground">
                        实际模型：{state.aiFeedback.resolved_ai.model_label}
                      </div>
                    ) : null}
                    <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {state.aiFeedback.feedback_text}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onReset(question.id)}>
            <RotateCcw className="h-4 w-4" />
            再做一次
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
