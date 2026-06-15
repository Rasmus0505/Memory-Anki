import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Clock3,
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
import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/features/palace-quiz/QuizQuestionInteraction'
import {
  generatePalaceQuizPreview,
  getGenerationPreviewSaveCount,
  type QuizGenerationPdfSourceDraft as QuizPdfSourceDraft,
} from '@/features/palace-quiz/quizGenerationController'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
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
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
import {
  getSubjectTreeApi,
  getSubjectsApi,
  uploadSubjectDocumentApi,
} from '@/shared/api/modules/knowledge'
import { getPalaceApi } from '@/shared/api/modules/palaces'
import {
  batchDeletePalaceQuizQuestionsApi,
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  getPalaceQuizQuestionsApi,
  recordPalaceQuizChoiceAttemptApi,
  recoverAndSavePalaceQuizGenerationFromAiLogApi,
  requestPalaceShortAnswerFeedbackApi,
  updatePalaceQuizQuestionApi,
} from '@/shared/api/modules/quizzes'
import { usePdfImportController } from '@/features/palace-edit/hooks/usePdfImportController'
import type { ImportSubjectOption } from '@/features/palace-edit/model/mindmap-import-types'
import {
  buildQuizGenerationHistoryTitle,
  deleteQuizGenerationHistory,
  getPreviewQuestionCount,
  loadQuizGenerationHistory,
  saveQuizGenerationHistory,
  type QuizGenerationHistoryItem,
  type QuizGenerationSourceKind,
} from '@/features/palace-quiz/quiz-generation-history'

type PalaceQuizTabKey = 'practice' | 'manage' | 'generate'
type PalaceQuizViewMode = 'single' | 'list'
type PalaceQuizScopeKey = 'all' | 'palace' | `mini:${number}`

interface PalaceQuizPageMeta {
  id: number
  title: string
  primary_chapter_id?: number | null
  primary_chapter?: { id: number; name: string; subject_id: number | null; parent_id?: number | null } | null
  mini_palaces?: MiniPalaceSummary[]
  chapters?: Array<{
    id: number
    name?: string
    subject_id?: number | null
    parent_id?: number | null
    is_explicit?: boolean
    subject?: { id: number; name: string } | null
  }>
}

interface ChapterTreeNode {
  id: number
  name: string
  subject_id?: number | null
  parent_id?: number | null
  children?: ChapterTreeNode[]
}

interface SubjectTreePayload {
  subject: { id: number; name: string } | null
  chapters: ChapterTreeNode[]
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

function readPersistedViewMode(): PalaceQuizViewMode {
  if (typeof window === 'undefined') return 'single'
  const raw = window.localStorage.getItem(QUIZ_VIEW_MODE_STORAGE_KEY)
  return raw === 'list' ? 'list' : 'single'
}

function readInitialTab(searchParams: URLSearchParams): PalaceQuizTabKey {
  const tab = searchParams.get('tab')
  return tab === 'manage' || tab === 'generate' ? tab : 'practice'
}

function getQuestionOwnershipLabel(question: PalaceQuizQuestion) {
  if (question.classified_chapter?.name) {
    return `章节小节：${question.classified_chapter.name}`
  }
  if (question.source_chapter?.name) {
    return `章节题：${question.source_chapter.name}`
  }
  return question.mini_palace?.name ? `小宫殿：${question.mini_palace.name}` : '主宫殿题'
}

function getQuestionSourceLabel(sourceMeta?: PalaceQuizSourceMeta | null) {
  const sourceKind = sourceMeta?.source_kind || 'manual'
  if (sourceKind === 'manual') return '手动'
  if (sourceKind === 'chapter_outline') return '章节AI生成'
  if (sourceKind === 'subject_pdf') return 'PDF生成'
  if (sourceKind === 'image' || sourceKind === 'images' || sourceKind === 'image_upload') {
    return '图片AI生成'
  }
  return 'AI生成'
}

function getPdfSourceRoleLabel(roleHint?: string | null) {
  return roleHint === 'answer' ? '答案' : '题目'
}

function shouldShowPdfPairingModelSelector(pdfSources: QuizPdfSourceDraft[] | undefined) {
  const normalizedRoles = new Set(
    (pdfSources || [])
      .map((item) => String(item.role_hint || '').trim().toLowerCase())
      .filter(Boolean),
  )
  return normalizedRoles.has('question') && normalizedRoles.has('answer')
}

function formatResolvedAiSteps(
  resolvedAiSteps: PalaceQuizGenerationPreview['resolved_ai_steps'] | undefined | null,
) {
  const labels: string[] = []
  if (resolvedAiSteps?.generation?.model_label) {
    labels.push(`识别 ${resolvedAiSteps.generation.model_label}`)
  }
  if (resolvedAiSteps?.pairing?.model_label) {
    labels.push(`配对 ${resolvedAiSteps.pairing.model_label}`)
  }
  if (resolvedAiSteps?.review?.model_label) {
    labels.push(`复核 ${resolvedAiSteps.review.model_label}`)
  }
  return labels.join(' · ')
}

function getQuestionTypeLabel(questionType: PalaceQuizQuestionType) {
  if (questionType === 'multiple_choice') return '选择题'
  if (questionType === 'true_false') return '判断题'
  if (questionType === 'fill_blank') return '填空题'
  if (questionType === 'matching') return '连线题'
  if (questionType === 'ordering') return '排序题'
  if (questionType === 'categorization') return '归类题'
  return '简答题'
}

function canManuallyEditQuestion(questionType: PalaceQuizQuestionType) {
  return questionType === 'multiple_choice' || questionType === 'short_answer'
}

function collectAllowedChapterIds(
  nodes: ChapterTreeNode[],
  explicitIds: Set<number>,
  inheritedAllowed = false,
  collector: Set<number> = new Set(),
) {
  let subtreeHasExplicit = false
  nodes.forEach((node) => {
    const isExplicit = explicitIds.has(node.id)
    const childSubtreeHasExplicit = collectAllowedChapterIds(
      node.children || [],
      explicitIds,
      inheritedAllowed || isExplicit,
      collector,
    )
    const isAllowed = inheritedAllowed || isExplicit || childSubtreeHasExplicit
    if (isAllowed) {
      collector.add(node.id)
    }
    if (isExplicit || childSubtreeHasExplicit) {
      subtreeHasExplicit = true
    }
  })
  return subtreeHasExplicit
}

function findChapterPath(
  nodes: ChapterTreeNode[],
  targetId: number,
  trail: ChapterTreeNode[] = [],
): ChapterTreeNode[] | null {
  for (const node of nodes) {
    const nextTrail = [...trail, node]
    if (node.id === targetId) return nextTrail
    const nested = findChapterPath(node.children || [], targetId, nextTrail)
    if (nested) return nested
  }
  return null
}

function resolveChapterInfoFromTrees(
  trees: SubjectTreePayload[],
  chapterId: number | null,
): { subjectName: string; path: ChapterTreeNode[] } | null {
  if (!chapterId) return null
  for (const tree of trees) {
    const path = findChapterPath(tree.chapters || [], chapterId)
    if (path) {
      return {
        subjectName: tree.subject?.name || '未命名学科',
        path,
      }
    }
  }
  return null
}

function buildChapterSummary(info: { subjectName: string; path: ChapterTreeNode[] } | null) {
  return info
    ? `${info.subjectName} / ${info.path.map((item) => item.name).join(' / ')}`
    : '尚未选择题目所属章节'
}

function PreviewQuestionAnswerSummary({ question }: { question: PalaceQuizQuestionDraft }) {
  if (question.question_type === 'multiple_choice') {
    return (
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
    )
  }

  if (question.question_type === 'true_false') {
    return (
      <div className="mt-2.5 space-y-2 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
        <div>正确答案：{question.answer_payload.correct_answer ? '对' : '错'}</div>
        {question.answer_payload.false_explanation ? (
          <div className="text-muted-foreground">
            易错点：{question.answer_payload.false_explanation}
          </div>
        ) : null}
      </div>
    )
  }

  if (question.question_type === 'fill_blank') {
    return (
      <div className="mt-2.5 space-y-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
        {(question.answer_payload.blanks || []).map((blank) => (
          <div key={blank.id}>
            {blank.id}：{blank.answer}
            {blank.aliases?.length ? (
              <span className="text-muted-foreground">
                {' '}
                （别名：{blank.aliases.join(' / ')}）
              </span>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  if (question.question_type === 'matching') {
    return (
      <div className="mt-2.5 space-y-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
        {(question.answer_payload.pairs || []).map((pair) => (
          <div key={pair.left_id}>
            {pair.left} → {pair.right}
          </div>
        ))}
      </div>
    )
  }

  if (question.question_type === 'ordering') {
    const itemById = Object.fromEntries(
      (question.answer_payload.items || []).map((item) => [item.id, item]),
    )
    return (
      <div className="mt-2.5 space-y-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
        {(question.answer_payload.correct_order_ids || []).map((itemId, index) => (
          <div key={itemId}>
            {index + 1}. {itemById[itemId]?.text || itemId}
          </div>
        ))}
      </div>
    )
  }

  if (question.question_type === 'categorization') {
    const itemsByCategory = new Map<string, string[]>()
    ;(question.answer_payload.items || []).forEach((item) => {
      const categoryId = item.category_id || 'unknown'
      const bucket = itemsByCategory.get(categoryId) || []
      bucket.push(item.text)
      itemsByCategory.set(categoryId, bucket)
    })

    return (
      <div className="mt-2.5 space-y-2 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
        {(question.answer_payload.categories || []).map((category) => (
          <div key={category.id}>
            <div className="font-medium">{category.name}</div>
            <div className="text-muted-foreground">
              {(itemsByCategory.get(category.id) || []).join('、') || '暂无'}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-2.5 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-sm">
      参考答案：{question.answer_payload.reference_answer || '暂无'}
    </div>
  )
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
  const [searchParams, setSearchParams] = useSearchParams()
  const palaceId = id ? Number(id) : null
  const [palace, setPalace] = useState<PalaceQuizPageMeta | null>(null)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [activeTab, setActiveTab] = useState<PalaceQuizTabKey>(() => readInitialTab(searchParams))
  const [viewMode, setViewMode] = useState<PalaceQuizViewMode>(readPersistedViewMode)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questionScope, setQuestionScope] = useState<PalaceQuizScopeKey>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null)
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(buildEmptyQuestionForm)
  const [manageSaving, setManageSaving] = useState(false)
  const [manageDeletingId, setManageDeletingId] = useState<number | null>(null)
  const [manageBulkDeleting, setManageBulkDeleting] = useState(false)
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([])
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
  const [classificationResult, setClassificationResult] = useState<PalaceQuizMiniPalaceClassificationResult | null>(null)
  const [subjects, setSubjects] = useState<Array<{ id: number; name: string }>>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [rangeDialogOpen, setRangeDialogOpen] = useState(false)
  const [chapterTrees, setChapterTrees] = useState<SubjectTreePayload[]>([])
  const [chapterTreesLoading, setChapterTreesLoading] = useState(false)
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)
  const [pendingChapterId, setPendingChapterId] = useState<number | null>(null)
  const { promptForAiOptions, promptForScenarioAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
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
  const getChapterHasChildren = (chapterId: number | null) => {
    if (!chapterId) return false
    const info = resolveChapterInfoFromTrees(chapterTrees, chapterId)
    return Boolean(info?.path[info.path.length - 1]?.children?.length)
  }
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
  const visibleQuestionIds = useMemo(
    () => filteredQuestions.map((question) => question.id),
    [filteredQuestions],
  )
  const allVisibleQuestionsSelected = useMemo(
    () =>
      visibleQuestionIds.length > 0 &&
      visibleQuestionIds.every((questionId) => selectedQuestionIds.includes(questionId)),
    [selectedQuestionIds, visibleQuestionIds],
  )
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
    const nextTab = readInitialTab(searchParams)
    setActiveTab((current) => (current === nextTab ? current : nextTab))
  }, [searchParams])

  useEffect(() => {
    const currentTab = searchParams.get('tab')
    if (currentTab === activeTab) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('tab', activeTab)
      return next
    }, { replace: true })
  }, [activeTab, searchParams, setSearchParams])

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

  useEffect(() => {
    setSelectedQuestionIds((current) =>
      current.filter((questionId) => questions.some((question) => question.id === questionId)),
    )
  }, [questions])

  useEffect(() => {
    if (generationClassifyByMiniPalace && !selectedChapterHasChildren) {
      setGenerationClassifyByMiniPalace(false)
    }
  }, [generationClassifyByMiniPalace, selectedChapterHasChildren])

  const refreshQuestions = async () => {
    if (!palaceId) return
    registerQuizActivity('quiz_refresh')
    emitQuizFeedback('quiz_nav_scope_change', { label: '刷新题库', audioScope: 'global' })
    const result = await getPalaceQuizQuestionsApi(palaceId)
    setQuestions(result.items || [])
  }

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

  const updateQuestionState = (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
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
        resolved: false,
        correct: false,
        shortAnswerText: '',
        shortAnswerSubmitted: false,
        shortAnswerFeedback: null,
        shortAnswerFeedbackLoading: false,
        selectedOptionId: '',
        trueFalseAnswer: undefined,
        blankInputs: {},
        submittedBlankIds: [],
        matchingPairs: {},
        selectedLeftId: null,
        orderingIds: undefined,
        categorizationAssignments: {},
        selectedCategorizationItemId: null,
      },
    }))
  }

  const handleResetQuestionState = (questionId: number) => {
    registerQuizActivity('question_reset')
    emitQuizFeedback('quiz_answer_reset', { label: '重做', audioScope: 'local' })
    resetQuestionState(questionId)
  }

  const handleChoiceSelect = (question: PalaceQuizQuestion, optionId: string) => {
    const currentState = questionStates[question.id]
    if (currentState?.resolved) return
    registerQuizActivity('choice_select')
    const isCorrect = question.answer_payload.correct_option_id === optionId
    emitQuizFeedback('quiz_answer_select', { label: optionId, audioScope: 'local' })
    void recordPalaceQuizChoiceAttemptApi(question.id, optionId)
      .then((response) => {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? response.question : item)),
        )
        emitQuizFeedback(isCorrect ? 'quiz_result_correct' : 'quiz_result_incorrect', {
          label: isCorrect ? '答对' : '答错',
          screenPulse: isCorrect ? 'soft' : null,
          audioScope: 'local',
        })
        emitQuizFeedback('quiz_result_reveal', {
          label: isCorrect ? '揭晓' : '答案',
          screenPulse: null,
          audioScope: 'local',
        })
      })
      .catch((nextError) => {
        emitQuizFeedback('quiz_error_stat_failed', { label: '统计失败', audioScope: 'local' })
        toast.error(nextError instanceof Error ? nextError.message : '统计刷新失败。')
      })
  }

  const handleShortAnswerSubmit = (questionId: number) => {
    registerQuizActivity('short_answer_submit')
    emitQuizFeedback('quiz_answer_submit', { label: '提交答案', audioScope: 'local' })
    updateQuestionState(questionId, (state) => ({
      ...state,
      resolved: true,
      shortAnswerSubmitted: true,
      shortAnswerFeedback: null,
    }))
  }

  const handleShortAnswerFeedback = async (question: PalaceQuizQuestion) => {
    registerQuizActivity('short_answer_feedback')
    const state = questionStates[question.id] || {}
    const userAnswer = state.shortAnswerText?.trim() || ''
    if (!userAnswer) {
      emitQuizFeedback('quiz_error_missing_input', { label: '先写答案', audioScope: 'local' })
      toast.error('请先填写你的答案。')
      return
    }
    emitQuizFeedback('quiz_generate_start', { label: 'AI点评', audioScope: 'global' })
    updateQuestionState(question.id, (current) => ({
      ...current,
      shortAnswerFeedbackLoading: true,
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
          shortAnswerFeedbackLoading: false,
        }))
        emitQuizFeedback('quiz_generate_cancel', { label: '取消AI', audioScope: 'global' })
        return
      }
      const feedback = await requestPalaceShortAnswerFeedbackApi(question.id, userAnswer, aiOptions)
      updateQuestionState(question.id, (current) => ({
        ...current,
        shortAnswerFeedback: feedback,
        shortAnswerFeedbackLoading: false,
      }))
      emitQuizFeedback('quiz_result_ai_feedback_ready', { label: 'AI完成', audioScope: 'global' })
    } catch (nextError) {
      updateQuestionState(question.id, (current) => ({
        ...current,
        shortAnswerFeedbackLoading: false,
      }))
      emitQuizFeedback('quiz_error_ai_failed', { label: 'AI失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : 'AI 点评失败。')
    }
  }

  const handleStartCreateQuestion = () => {
    registerQuizActivity('manage_create_start')
    emitQuizFeedback('quiz_manage_create_start', { label: '新增题目', audioScope: 'local' })
    setEditingQuestionId(null)
    setQuestionForm(buildEmptyQuestionForm())
  }

  const handleEditQuestion = (question: PalaceQuizQuestion) => {
    if (!canManuallyEditQuestion(question.question_type)) {
      toast.message('这类题目前只支持做题、查看和删除，暂不支持手工编辑。')
      return
    }
    registerQuizActivity('manage_edit_question')
    emitQuizFeedback('quiz_manage_edit_start', { label: '编辑题目', audioScope: 'local' })
    setActiveTab('manage')
    setEditingQuestionId(question.id)
    setQuestionForm(buildQuestionFormFromQuestion(question))
  }

  const handleSaveQuestion = async () => {
    if (!palaceId) return
    registerQuizActivity('manage_save_question')
    emitQuizFeedback('quiz_manage_save', {
      label: editingQuestionId != null ? '更新题目' : '保存题目',
      audioScope: 'global',
    })
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
      emitQuizFeedback('quiz_manage_save', {
        label: editingQuestionId != null ? '已更新' : '已新增',
        audioScope: 'global',
      })
      await refreshQuestions()
      setEditingQuestionId(null)
      setQuestionForm(buildEmptyQuestionForm())
    } catch (nextError) {
      emitQuizFeedback('quiz_error_persist_failed', { label: '保存失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '保存题目失败。')
    } finally {
      setManageSaving(false)
    }
  }

  const handleDeleteQuestion = async (questionId: number) => {
    if (!window.confirm('确定删除这道题吗？')) return
    registerQuizActivity('manage_delete_question')
    emitQuizFeedback('quiz_manage_delete', { label: '删除题目', audioScope: 'local' })
    setManageDeletingId(questionId)
    try {
      await deletePalaceQuizQuestionApi(questionId)
      toast.success('题目已删除')
      emitQuizFeedback('quiz_manage_delete', { label: '已删除', audioScope: 'local' })
      await refreshQuestions()
      setSelectedQuestionIds((current) => current.filter((item) => item !== questionId))
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
      emitQuizFeedback('quiz_error_persist_failed', { label: '删除失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '删除题目失败。')
    } finally {
      setManageDeletingId(null)
    }
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
      if (existingIndex >= 0) {
        next[existingIndex] = nextSource
      } else {
        next.push(nextSource)
      }
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

  const handlePdfSourceRoleHintChange = (
    subjectDocumentId: number,
    value: PalaceQuizPdfSourceRole,
  ) => {
    emitQuizFeedback('quiz_generate_attach_source', {
      label: value === 'answer' ? '设为答案' : '设为题目',
      audioScope: 'local',
    })
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

  const persistGenerationHistory = (
    preview: PalaceQuizGenerationPreview,
    sourceKind: QuizGenerationSourceKind,
    pdfSources: QuizPdfSourceDraft[],
    imageFileNames: string[],
    extraPrompt: string,
    enableSecondaryReview: boolean,
    classifyByMiniPalace: boolean,
  ) => {
    if (!palaceId || typeof window === 'undefined') return
    const history = saveQuizGenerationHistory(palaceId, {
      sourceKind,
      title: buildQuizGenerationHistoryTitle(
        sourceKind,
        pdfSources.map((item) => ({
          subject_document_id: item.subject_document_id,
          document_name: item.document_name,
          page_selection: [...item.page_selection],
          role_hint: item.role_hint,
        })),
        imageFileNames,
      ),
      extraPrompt,
      enableSecondaryReview,
      classifyByMiniPalace,
      selectedChapterId,
      selectedChapterPath: selectedChapterSummary !== '尚未选择题目所属章节' ? selectedChapterSummary : '',
      pdfSources: pdfSources.map((item) => ({
        subject_document_id: item.subject_document_id,
        document_name: item.document_name,
        page_selection: [...item.page_selection],
        role_hint: item.role_hint,
      })),
      imageFileNames,
      previewQuestionCount: preview.questions.length,
      savableQuestionCount: getPreviewQuestionCount(preview),
      aiCallLogId: preview.ai_call_log_id,
    })
    setGenerationHistory(history)
  }

  const executeGenerationPreview = async (
    config: {
      sourceKind: QuizGenerationSourceKind
      pdfSources: QuizPdfSourceDraft[]
      files: File[]
      extraPrompt: string
      enableSecondaryReview: boolean
      classifyByMiniPalace: boolean
    },
  ) => {
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
      let aiOptions: import('@/shared/api/contracts').AiRuntimeOptions | undefined
      let aiOptionsByScenario: import('@/shared/api/contracts').AiScenarioRuntimeOptionsMap | undefined
      if (config.sourceKind === 'subject-pdf') {
        const usePairingSelector = shouldShowPdfPairingModelSelector(config.pdfSources)
        if (usePairingSelector) {
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
          })
          aiOptions = aiOptionsByScenario?.quiz_pdf_generation
        } else {
          aiOptions = await promptForAiOptions({
            scenarioKey: 'quiz_pdf_generation',
            entrypointKey: 'quiz-generate-pdf',
            title: 'PDF 做题生成配置',
          })
        }
      } else {
        aiOptions = await promptForAiOptions({
          scenarioKey: 'quiz_image_generation',
          entrypointKey:
            config.sourceKind === 'image-batch'
              ? 'quiz-generate-images-batch'
              : 'quiz-generate-images-single',
          title: '图片做题生成配置',
        })
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
      if (config.sourceKind === 'subject-pdf') {
        setGenerationPreview(preview)
        setGenerationStreamStatus('题目预览已生成')
        emitQuizFeedback('quiz_generate_preview_ready', {
          label: config.classifyByMiniPalace ? '分组预览' : '题目预览',
          audioScope: 'global',
        })
        config.pdfSources.forEach((item) => {
          pdfController.persistAnalyzedPdfPages(item.subject_document_id, item.page_selection)
        })
        persistGenerationHistory(
          preview,
          config.sourceKind,
          config.pdfSources,
          [],
          config.extraPrompt,
          config.enableSecondaryReview,
          config.classifyByMiniPalace,
        )
      } else {
        setGenerationPreview(preview)
        emitQuizFeedback('quiz_generate_preview_ready', { label: '图片预览', audioScope: 'global' })
        persistGenerationHistory(
          preview,
          config.sourceKind,
          [],
          config.files.map((file) => file.name),
          config.extraPrompt,
          config.enableSecondaryReview,
          config.classifyByMiniPalace,
        )
      }
    } catch (nextError) {
      emitQuizFeedback('quiz_error_ai_failed', { label: '生成失败', audioScope: 'global' })
      setGenerationError(
        nextError instanceof Error ? nextError.message : '生成题目预览失败。',
      )
    } finally {
      setGenerationLoading(false)
    }
  }

  const handleToggleQuestionSelection = (questionId: number, checked: boolean) => {
    setSelectedQuestionIds((current) => {
      if (checked) {
        if (current.includes(questionId)) return current
        return [...current, questionId]
      }
      return current.filter((item) => item !== questionId)
    })
  }

  const handleToggleSelectAllVisibleQuestions = (checked: boolean) => {
    setSelectedQuestionIds((current) => {
      if (checked) {
        const next = new Set(current)
        visibleQuestionIds.forEach((questionId) => next.add(questionId))
        return Array.from(next)
      }
      const visibleSet = new Set(visibleQuestionIds)
      return current.filter((questionId) => !visibleSet.has(questionId))
    })
  }

  const handleBatchDeleteQuestions = async () => {
    if (selectedQuestionIds.length === 0) return
    if (!window.confirm(`确定批量删除所选的 ${selectedQuestionIds.length} 道题吗？`)) return
    registerQuizActivity('manage_batch_delete_questions')
    emitQuizFeedback('quiz_manage_batch_delete', { label: '批量删除', audioScope: 'global' })
    setManageBulkDeleting(true)
    try {
      await batchDeletePalaceQuizQuestionsApi(selectedQuestionIds)
      toast.success(`已删除 ${selectedQuestionIds.length} 道题目`)
      emitQuizFeedback('quiz_manage_batch_delete', { label: '批量删除完成', audioScope: 'global' })
      const deletedIdSet = new Set(selectedQuestionIds)
      await refreshQuestions()
      setSelectedQuestionIds([])
      setQuestionStates((current) => {
        const next = { ...current }
        deletedIdSet.forEach((questionId) => {
          delete next[questionId]
        })
        return next
      })
      if (editingQuestionId != null && deletedIdSet.has(editingQuestionId)) {
        setEditingQuestionId(null)
        setQuestionForm(buildEmptyQuestionForm())
      }
    } catch (nextError) {
      emitQuizFeedback('quiz_error_persist_failed', { label: '批量删除失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '批量删除题目失败。')
    } finally {
      setManageBulkDeleting(false)
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
      setActiveTab('practice')
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
            <Link to="/palaces/quiz">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                返回做题区
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
                emitQuizFeedback('quiz_nav_tab_switch', { label: tab.label, audioScope: 'global' })
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
                emitQuizFeedback('quiz_nav_view_switch', { label: '逐题模式', audioScope: 'global' })
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
                emitQuizFeedback('quiz_nav_view_switch', { label: '整页列表', audioScope: 'global' })
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
                emitQuizFeedback('quiz_nav_scope_change', { label: '全部题目', audioScope: 'global' })
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
                emitQuizFeedback('quiz_nav_scope_change', { label: '大宫殿', audioScope: 'global' })
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
                  emitQuizFeedback('quiz_nav_scope_change', {
                    label: miniPalace.name,
                    audioScope: 'global',
                  })
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
                      emitQuizFeedback('quiz_nav_question_prev', { label: '上一题', audioScope: 'local' })
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
                      emitQuizFeedback('quiz_nav_question_next', { label: '下一题', audioScope: 'local' })
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
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={selectedQuestionIds.length === 0 || manageBulkDeleting}
                  onClick={() => void handleBatchDeleteQuestions()}
                >
                  {manageBulkDeleting ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  批量删除所选
                </Button>
                <Button type="button" size="sm" onClick={handleStartCreateQuestion}>
                  <Plus className="h-4 w-4" />
                  新增题目
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={questionScope === 'all' ? 'default' : 'outline'}
                  onClick={() => {
                    emitQuizFeedback('quiz_nav_scope_change', { label: '全部题目', audioScope: 'global' })
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
                    emitQuizFeedback('quiz_nav_scope_change', { label: '大宫殿', audioScope: 'global' })
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
                      emitQuizFeedback('quiz_nav_scope_change', {
                        label: miniPalace.name,
                        audioScope: 'global',
                      })
                      setQuestionScope(`mini:${miniPalace.id}`)
                    }}
                  >
                    {miniPalace.name}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    aria-label="全选当前题目"
                    type="checkbox"
                    checked={allVisibleQuestionsSelected}
                    disabled={filteredQuestions.length === 0 || manageBulkDeleting}
                    onChange={(event) =>
                      handleToggleSelectAllVisibleQuestions(event.target.checked)
                    }
                  />
                  <span>全选当前列表</span>
                </label>
                <span className="text-muted-foreground">已选 {selectedQuestionIds.length} 题</span>
                {selectedQuestionIds.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedQuestionIds([])}
                  >
                    清空选择
                  </Button>
                ) : null}
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
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <input
                            aria-label={`选择题目 ${question.stem}`}
                            type="checkbox"
                            className="mt-1"
                            checked={selectedQuestionIds.includes(question.id)}
                            disabled={manageBulkDeleting || manageDeletingId === question.id}
                            onChange={(event) =>
                              handleToggleQuestionSelection(question.id, event.target.checked)
                            }
                          />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="secondary">#{index + 1}</Badge>
                              <Badge variant="outline">
                                {getQuestionTypeLabel(question.question_type)}
                              </Badge>
                              <Badge
                                variant={question.mini_palace_id == null ? 'secondary' : 'outline'}
                              >
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
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          {canManuallyEditQuestion(question.question_type) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 px-2.5"
                              onClick={() => handleEditQuestion(question)}
                            >
                              编辑
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5"
                            disabled={manageBulkDeleting || manageDeletingId === question.id}
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
                <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">题目所属章节范围</div>
                      <div className="text-sm text-muted-foreground">{selectedChapterSummary}</div>
                    </div>
                    <Button type="button" variant="outline" onClick={() => void handleOpenRangeDialog()}>
                      选择范围
                    </Button>
                  </div>
                </div>

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
                      <input
                        ref={subjectPdfUploadInputRef}
                        type="file"
                        accept="application/pdf,.pdf"
                        className="hidden"
                        onChange={(event) => {
                          const input = event.currentTarget
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
                              input.value = ''
                            })
                        }}
                        disabled={!pdfController.selectedSubjectId}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => subjectPdfUploadInputRef.current?.click()}
                        disabled={!pdfController.selectedSubjectId}
                      >
                        <Plus className="h-4 w-4" />
                        上传新 PDF 到资料库
                      </Button>
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
                    checked={generationEnableSecondaryReview}
                    onChange={(event) =>
                      setGenerationEnableSecondaryReview(event.target.checked)
                    }
                  />
                  <span>
                    <span className="font-medium">二次筛选</span>
                    <span className="mt-1 block text-muted-foreground">
                      开启后，会在题目生成或题答配对完成后，再按当前额外提示词做一次通用范围复核。关闭后，直接保留生成结果，不额外裁剪。
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={generationClassifyByMiniPalace}
                    onChange={(event) =>
                      setGenerationClassifyByMiniPalace(event.target.checked)
                    }
                    disabled={!selectedChapterHasChildren}
                  />
                  <span>
                    <span className="font-medium">按小宫殿分类保存</span>
                    <span className="mt-1 block text-muted-foreground">
                      {selectedChapterHasChildren
                        ? '开启后，题目会按当前所选范围的直接子章节分类，并以章节题的形式分别保存。'
                        : '当前范围没有直接子章节，暂时无法分类保存。'}
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
              <div>
                <CardTitle className="text-base">历史生成记录</CardTitle>
                <div className="mt-1 text-xs text-muted-foreground">
                  点击一条可回填到左侧配置，也可以直接按原配置重新生成。
                </div>
              </div>
              <Badge variant="outline">{generationHistory.length} 条</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {generationHistory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
                  还没有历史记录。先完成一次生成预览，这里会自动保存最近配置。
                </div>
              ) : (
                generationHistory.map((item) => {
                  const canRegenerate = item.sourceKind === 'subject-pdf'
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => applyHistoryConfig(item)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{item.title}</span>
                            <Badge variant="secondary">
                              {item.sourceKind === 'subject-pdf'
                                ? 'PDF'
                                : item.sourceKind === 'image-single'
                                  ? '单图'
                                  : '多图'}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {new Date(item.createdAt).toLocaleString()}
                            </span>
                            <span>预览 {item.previewQuestionCount} 题</span>
                            <span>可保存 {item.savableQuestionCount} 题</span>
                            {item.classifyByMiniPalace ? <span>按小宫殿分类保存</span> : null}
                            {item.enableSecondaryReview ? <span>二次筛选</span> : null}
                          </div>
                          {item.selectedChapterPath ? (
                            <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                              范围：{item.selectedChapterPath}
                            </div>
                          ) : null}
                          {item.extraPrompt ? (
                            <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                              提示词：{item.extraPrompt}
                            </div>
                          ) : null}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteGenerationHistory(item.id)}
                          title="删除历史记录"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => applyHistoryConfig(item)}
                        >
                          导入到左侧
                        </Button>
                        <Button
                          type="button"
                          disabled={!canRegenerate || generationLoading}
                          onClick={() => void handleRegenerateFromHistory(item)}
                        >
                          {historyRegeneratingId === item.id ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                          重新生成
                        </Button>
                      </div>
                      {!canRegenerate ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          图片历史会回填提示词和开关，但仍需重新上传图片。
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

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
                    <div>当前范围：{selectedChapterSummary}</div>
                    来源：{generationPreview.source_meta.source_kind} · 模式：
                    {generationPreview.source_meta.generation_mode}
                    {formatResolvedAiSteps(generationPreview.resolved_ai_steps) ? (
                      <span> · {formatResolvedAiSteps(generationPreview.resolved_ai_steps)}</span>
                    ) : generationPreview.resolved_ai?.model_label ? (
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
                      {generationPreview.grouped_questions.child_chapter_groups?.map((group) => (
                        <div key={group.classified_chapter_id} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{group.classified_chapter_name}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {group.questions.length} 题
                            </span>
                          </div>
                          {group.questions.map((question, index) => (
                            <PreviewQuestionCard
                              key={`${group.classified_chapter_id}_${index}_${question.stem}`}
                              question={question}
                              index={index}
                            />
                          ))}
                        </div>
                      ))}
                      {(generationPreview.grouped_questions.mini_palace_groups || []).map((group) => (
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
                          <Badge variant="outline">
                            {generationPreview.grouped_questions.child_chapter_groups?.length
                              ? '未归类，仍保存到当前所选范围'
                              : '未归类，仍保存到大宫殿'}
                          </Badge>
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

      <Dialog open={rangeDialogOpen} onOpenChange={setRangeDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>选择范围</DialogTitle>
            <DialogDescription>
              选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节节点，也支持直接选择父级大章节整章生成。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4">
            <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
              当前选择：{pendingChapterId ? pendingChapterSummary : '尚未选择题目所属章节'}
            </div>
            {chapterTreesLoading ? (
              <div className="text-sm text-muted-foreground">正在加载章节树...</div>
            ) : chapterTrees.length === 0 ? (
              <div className="text-sm text-muted-foreground">当前宫殿还没有可用的章节范围。</div>
            ) : (
              <div className="max-h-[440px] space-y-4 overflow-y-auto">
                {chapterTrees.map((tree) => (
                  <div key={tree.subject?.id ?? 'subject'} className="space-y-2">
                    <div className="text-sm font-medium">{tree.subject?.name || '未命名学科'}</div>
                    <div className="space-y-1">
                      {(tree.chapters || []).map((node) => (
                        <ChapterRangeTree
                          key={node.id}
                          node={node}
                          allowedChapterIds={allowedChapterIds}
                          selectedChapterId={pendingChapterId}
                          onSelect={setPendingChapterId}
                          depth={0}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRangeDialogOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleConfirmRangeSelection}>
              确认范围
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface QuizQuestionCardProps {
  question: PalaceQuizQuestion
  state: QuizRuntimeState | undefined
  compact?: boolean
  onChoiceSelect: (question: PalaceQuizQuestion, optionId: string) => void
  onStateChange: (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
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
        <Badge variant="outline">{getQuestionTypeLabel(question.question_type)}</Badge>
      </div>
      <div className="text-sm font-medium leading-6">{question.stem}</div>
      <PreviewQuestionAnswerSummary question={question} />
      <div className="mt-2.5 text-sm text-muted-foreground">
        解析：{question.analysis || '暂无解析'}
      </div>
    </div>
  )
}

function ChapterRangeTree({
  node,
  allowedChapterIds,
  selectedChapterId,
  onSelect,
  depth,
}: {
  node: ChapterTreeNode
  allowedChapterIds: Set<number>
  selectedChapterId: number | null
  onSelect: (chapterId: number) => void
  depth: number
}) {
  const isAllowed = allowedChapterIds.has(node.id)
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={!isAllowed}
        onClick={() => isAllowed && onSelect(node.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm',
          isAllowed
            ? selectedChapterId === node.id
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : 'border-border/70 bg-background hover:border-primary/30'
            : 'cursor-not-allowed border-border/50 bg-background/50 text-muted-foreground opacity-60',
        )}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <span>{selectedChapterId === node.id ? '●' : '○'}</span>
        <span>{node.name}</span>
      </button>
      {(node.children || []).map((child) => (
        <ChapterRangeTree
          key={child.id}
          node={child}
          allowedChapterIds={allowedChapterIds}
          selectedChapterId={selectedChapterId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
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
            <Badge variant="outline">{getQuestionTypeLabel(question.question_type)}</Badge>
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
        <QuizQuestionInteraction
          question={question}
          state={state}
          compact={compact}
          onStateChange={(updater) => onStateChange(question.id, updater)}
          onChoiceResolve={(optionId) => onChoiceSelect(question, optionId)}
          onShortAnswerSubmit={() => onShortAnswerSubmit(question.id)}
          onRequestShortAnswerFeedback={() => void onShortAnswerFeedback(question)}
        />

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
