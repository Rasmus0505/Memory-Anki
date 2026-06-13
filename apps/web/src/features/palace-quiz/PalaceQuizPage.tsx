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
import type {
  MiniPalaceSummary,
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
  previewPalaceQuizGenerationFromPdfApi,
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

export default function PalaceQuizPage() {
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
  const [generationLoading, setGenerationLoading] = useState(false)
  const [generationSaving, setGenerationSaving] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [generationClassifyByMiniPalace, setGenerationClassifyByMiniPalace] = useState(false)
  const [classificationLoading, setClassificationLoading] = useState(false)
  const [classificationResult, setClassificationResult] = useState<{
    mini_palace_groups: Array<{
      mini_palace_id: number
      mini_palace_name: string
      question_count: number
    }>
    copied_question_count: number
    unassigned_count: number
    ai_call_log_id: string | null
  } | null>(null)
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

  const registerQuizActivity = (source: string) => {
    timer.registerActivity('practice_interaction', { source })
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(QUIZ_VIEW_MODE_STORAGE_KEY, viewMode)
    }
  }, [viewMode])

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

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
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'quiz')) return
    timer.start({ source: 'page_enter' })
  }, [palaceId, timer])

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

  const handleChoiceSelect = (question: PalaceQuizQuestion, optionId: string) => {
    const currentState = questionStates[question.id]
    if (currentState?.choiceResolved) return
    registerQuizActivity('choice_select')
    const isCorrect = question.answer_payload.correct_option_id === optionId
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
      })
      .catch((nextError) => {
        toast.error(nextError instanceof Error ? nextError.message : '统计刷新失败。')
      })
  }

  const handleShortAnswerSubmit = (questionId: number) => {
    registerQuizActivity('short_answer_submit')
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
      toast.error('请先填写你的答案。')
      return
    }
    updateQuestionState(question.id, (current) => ({
      ...current,
      aiFeedbackLoading: true,
    }))
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'quiz_text',
        entrypointKey: 'quiz-short-answer-feedback',
        title: '简答题 AI 点评配置',
      })
      if (!aiOptions) {
        updateQuestionState(question.id, (current) => ({
          ...current,
          aiFeedbackLoading: false,
        }))
        return
      }
      const feedback = await requestPalaceShortAnswerFeedbackApi(question.id, userAnswer, aiOptions)
      updateQuestionState(question.id, (current) => ({
        ...current,
        aiFeedback: feedback,
        aiFeedbackLoading: false,
      }))
    } catch (nextError) {
      updateQuestionState(question.id, (current) => ({
        ...current,
        aiFeedbackLoading: false,
      }))
      toast.error(nextError instanceof Error ? nextError.message : 'AI 点评失败。')
    }
  }

  const handleStartCreateQuestion = () => {
    registerQuizActivity('manage_create_start')
    setEditingQuestionId(null)
    setQuestionForm(buildEmptyQuestionForm())
  }

  const handleEditQuestion = (question: PalaceQuizQuestion) => {
    registerQuizActivity('manage_edit_question')
    setActiveTab('manage')
    setEditingQuestionId(question.id)
    setQuestionForm(buildQuestionFormFromQuestion(question))
  }

  const handleSaveQuestion = async () => {
    if (!palaceId) return
    registerQuizActivity('manage_save_question')
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
      await refreshQuestions()
      setEditingQuestionId(null)
      setQuestionForm(buildEmptyQuestionForm())
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '保存题目失败。')
    } finally {
      setManageSaving(false)
    }
  }

  const handleDeleteQuestion = async (questionId: number) => {
    if (!window.confirm('确定删除这道题吗？')) return
    registerQuizActivity('manage_delete_question')
    setManageDeletingId(questionId)
    try {
      await deletePalaceQuizQuestionApi(questionId)
      toast.success('题目已删除')
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
      toast.error(nextError instanceof Error ? nextError.message : '删除题目失败。')
    } finally {
      setManageDeletingId(null)
    }
  }

  const handleImageFileChange = (fileList: FileList | null) => {
    registerQuizActivity('generation_select_files')
    const nextFiles = Array.from(fileList || [])
    setGenerationFiles(
      generationSourceKind === 'image-single' ? nextFiles.slice(0, 1) : nextFiles,
    )
    setGenerationError('')
  }

  const handleGeneratePreview = async () => {
    if (!palaceId) return
    registerQuizActivity('generation_preview')
    setGenerationLoading(true)
    setGenerationError('')
    setGenerationPreview(null)
    try {
      if (generationClassifyByMiniPalace && miniPalaces.length === 0) {
        throw new Error('当前宫殿还没有小宫殿，无法按小宫殿分类保存。')
      }
      const aiOptions = await promptForAiOptions({
        scenarioKey: generationSourceKind === 'subject-pdf' ? 'vision' : 'vision',
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
        setGenerationLoading(false)
        return
      }
      if (generationSourceKind === 'subject-pdf') {
        if (!pdfController.selectedSubjectDocumentId) {
          throw new Error('请先选择 PDF 资料。')
        }
        if (pdfController.selectedPdfPages.length === 0) {
          throw new Error('请至少选择一页 PDF。')
        }
        const preview = await previewPalaceQuizGenerationFromPdfApi(palaceId, {
          subject_document_id: pdfController.selectedSubjectDocumentId,
          page_selection: pdfController.selectedPdfPages,
          extra_prompt: pdfController.rangePrompt,
          classify_by_mini_palace: generationClassifyByMiniPalace,
          ai_options: aiOptions,
        })
        setGenerationPreview(preview)
        pdfController.persistAnalyzedPdfPages(
          pdfController.selectedSubjectDocumentId,
          pdfController.selectedPdfPages,
        )
      } else {
        if (generationFiles.length === 0) {
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
      }
    } catch (nextError) {
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
      await refreshQuestions()
      setGenerationPreview(null)
      setActiveTab('practice')
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '保存 AI 题目失败。')
    } finally {
      setGenerationSaving(false)
    }
  }

  const handleClassifyExistingQuestions = async () => {
    if (!palaceId) return
    registerQuizActivity('generation_classify_existing_to_mini_palaces')
    setClassificationLoading(true)
    setClassificationResult(null)
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'quiz_mini_palace',
        entrypointKey: 'quiz-classify-existing-mini-palace',
        title: '已有题库归类配置',
      })
      if (!aiOptions) {
        setClassificationLoading(false)
        return
      }
      const result = await classifyPalaceQuizQuestionsToMiniPalacesApi(palaceId, aiOptions)
      setClassificationResult(result)
      toast.success('已有题库已按小宫殿归类')
      await refreshQuestions()
    } catch (nextError) {
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
              onClick={() => setQuestionScope('all')}
            >
              全部
            </Button>
            <Button
              type="button"
              size="sm"
              variant={questionScope === 'palace' ? 'default' : 'outline'}
              onClick={() => setQuestionScope('palace')}
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
                onClick={() => setQuestionScope(`mini:${miniPalace.id}`)}
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
                onReset={resetQuestionState}
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
                  onChoiceSelect={handleChoiceSelect}
                  onStateChange={updateQuestionState}
                  onShortAnswerSubmit={handleShortAnswerSubmit}
                  onShortAnswerFeedback={handleShortAnswerFeedback}
                  onReset={resetQuestionState}
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
                  onClick={() => setQuestionScope('all')}
                >
                  全部
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={questionScope === 'palace' ? 'default' : 'outline'}
                  onClick={() => setQuestionScope('palace')}
                >
                  大宫殿
                </Button>
                {miniPalaces.map((miniPalace) => (
                  <Button
                    key={miniPalace.id}
                    type="button"
                    size="sm"
                    variant={questionScope === `mini:${miniPalace.id}` ? 'default' : 'outline'}
                    onClick={() => setQuestionScope(`mini:${miniPalace.id}`)}
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
                filteredQuestions.map((question, index) => (
                  <div
                    key={question.id}
                    className={cn(
                      'rounded-2xl border px-4 py-4',
                      editingQuestionId === question.id
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border/70 bg-background/70',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">#{index + 1}</Badge>
                          <Badge variant="outline">
                            {question.question_type === 'multiple_choice' ? '选择题' : '简答题'}
                          </Badge>
                          <Badge variant={question.mini_palace_id == null ? 'secondary' : 'outline'}>
                            {getQuestionOwnershipLabel(question)}
                          </Badge>
                          {question.question_type === 'multiple_choice' ? (
                            <span className="text-xs text-muted-foreground">
                              答对 {question.correct_count} 次 / 答错 {question.incorrect_count} 次
                            </span>
                          ) : null}
                        </div>
                        <div className="text-sm font-medium">{question.stem}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditQuestion(question)}
                        >
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
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
                ))
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
                    千问 Turbo 判断哪些题同时属于哪些小宫殿，并复制写入对应小宫殿题库。
                  </div>
                  {classificationResult ? (
                    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
                      <div>本次写入 {classificationResult.copied_question_count} 道小宫殿题。</div>
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

                    {pdfController.pdfPageMeta.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {pdfController.pdfPageMeta.map((page) => {
                          const selected = pdfController.selectedPdfPages.includes(page.page_number)
                          return (
                            <button
                              key={page.page_number}
                              type="button"
                              className={cn(
                                'overflow-hidden rounded-2xl border text-left transition-colors',
                                selected
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border/70 bg-background/70',
                              )}
                              onClick={() => pdfController.togglePdfPage(page.page_number)}
                            >
                              <img
                                src={page.thumbnail_url}
                                alt={`PDF 第 ${page.page_number} 页`}
                                className="h-36 w-full bg-white object-cover"
                              />
                              <div className="px-3 py-2 text-xs">
                                第 {page.page_number} 页
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border/80 px-4 py-5 text-sm text-muted-foreground">
                        选择 PDF 后，这里会显示页面缩略图，点选即可加入页码范围。
                      </div>
                    )}
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
                        ? '开启后，题目仍先用当前视觉模型生成，再用千问 Turbo 按小宫殿分组返回，保存时自动分宫殿入库。'
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
            </CardHeader>
            <CardContent className="space-y-4">
              {!generationPreview ? (
                <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                  先生成预览，这里会显示 AI 返回的题目草稿。确认后再批量写入题库。
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                    来源：{generationPreview.source_meta.source_kind} · 模式：
                    {generationPreview.source_meta.generation_mode}
                    {generationPreview.ai_call_log_id ? (
                      <span> · AI日志 {generationPreview.ai_call_log_id}</span>
                    ) : null}
                  </div>

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
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">#{index + 1}</Badge>
        <Badge variant="outline">
          {question.question_type === 'multiple_choice' ? '选择题' : '简答题'}
        </Badge>
      </div>
      <div className="text-sm font-medium">{question.stem}</div>
      {question.question_type === 'multiple_choice' ? (
        <div className="mt-3 space-y-2">
          {question.options.map((option) => (
            <div
              key={option.id}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm',
                option.id === question.answer_payload.correct_option_id
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-border/70 bg-background',
              )}
            >
              {option.id}. {option.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-border/70 bg-background px-3 py-3 text-sm">
          参考答案：{question.answer_payload.reference_answer || '暂无'}
        </div>
      )}
      <div className="mt-3 text-sm text-muted-foreground">
        解析：{question.analysis || '暂无解析'}
      </div>
    </div>
  )
}

function QuizQuestionCard({
  question,
  state,
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
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {question.question_type === 'multiple_choice' ? '选择题' : '简答题'}
            </Badge>
            <Badge variant={question.mini_palace_id == null ? 'secondary' : 'outline'}>
              {getQuestionOwnershipLabel(question)}
            </Badge>
            {question.question_type === 'multiple_choice' ? (
              <span className="text-xs text-muted-foreground">
                答对 {question.correct_count} 次 / 答错 {question.incorrect_count} 次
              </span>
            ) : null}
          </div>
          <CardTitle className="text-base leading-7">{question.stem}</CardTitle>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(question)}>
          编辑
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {question.question_type === 'multiple_choice' ? (
          <>
            <div className="grid gap-3">
              {(question.options || []).map((option) => {
                const tone = getOptionTone(question, state, option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-left text-sm transition-colors',
                      tone === 'correct' && 'border-emerald-300 bg-emerald-50 text-emerald-900',
                      tone === 'incorrect' && 'border-rose-300 bg-rose-50 text-rose-900',
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
              <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-sm font-medium">
                  {state.choiceCorrect ? '回答正确' : '回答错误'}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  正确答案：{question.answer_payload.correct_option_id || '暂无'}
                </div>
                <div className="mt-3 text-sm">
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
                rows={5}
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
              <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm">
                <div className="font-medium">参考答案</div>
                <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {question.answer_payload.reference_answer || '暂无参考答案'}
                </div>
                <div className="mt-4 font-medium">解析</div>
                <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {question.analysis || '暂无解析'}
                </div>
                {state?.aiFeedback ? (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
                    <div className="mb-2 text-sm font-medium">AI点评</div>
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
