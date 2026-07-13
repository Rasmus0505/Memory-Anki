import type {
  PalaceSegmentSummary,
  PalaceQuizSegmentClassificationResult,
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceQuizSourceMeta,
} from '@/shared/api/contracts'

export type PalaceQuizTabKey = 'practice' | 'manage' | 'generate'
export type PalaceQuizViewMode = 'single' | 'list'
export type PalaceQuizScopeKey = 'all' | 'palace' | `segment:${number}`

export interface PalaceQuizPageMeta {
  id: number
  title: string
  primary_chapter_id?: number | null
  primary_chapter?: { id: number; name: string; subject_id: number | null; parent_id?: number | null } | null
  segments?: PalaceSegmentSummary[]
  chapters?: Array<{
    id: number
    name?: string
    subject_id?: number | null
    parent_id?: number | null
    is_explicit?: boolean
    subject?: { id: number; name: string } | null
  }>
}

export interface ChapterTreeNode {
  id: number
  name: string
  subject_id?: number | null
  parent_id?: number | null
  children?: ChapterTreeNode[]
}

export interface SubjectTreePayload {
  subject: { id: number; name: string } | null
  chapters: ChapterTreeNode[]
}

export interface QuestionFormState {
  question_type: PalaceQuizQuestionType
  stem: string
  options: Array<{ id: string; text: string }>
  correct_option_id: string
  reference_answer: string
  analysis: string
  source_meta: PalaceQuizSourceMeta
}

export interface PalaceQuizGenerationStateSnapshot {
  sourceKind: QuizGenerationSourceKind
  previewQuestionCount: number
  selectedChapterSummary: string
  classificationResult: PalaceQuizSegmentClassificationResult | null
}

export type QuizGenerationSourceKind = 'image-single' | 'image-batch' | 'text-files'

export const QUIZ_VIEW_MODE_STORAGE_KEY = 'memory_anki_palace_quiz_view_mode'

const QUESTION_SOURCE_LABELS: Record<string, string> = {
  image_batch: '多图生成',
  image_single: '单图生成',
  text_files: '文本生成',
  mindmap_review: '脑图复习生成',
}

const QUESTION_TYPE_LABELS = {
  multiple_choice: '选择题',
  short_answer: '简答题',
  true_false: '判断题',
  fill_blank: '填空题',
  matching: '连线题',
  ordering: '排序题',
  categorization: '归类题',
} satisfies Record<PalaceQuizQuestionType, string>

export function buildManualSourceMeta(): PalaceQuizSourceMeta {
  return {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: new Date().toISOString(),
    generation_mode: 'manual',
  }
}

export function buildEmptyQuestionForm(): QuestionFormState {
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

export function buildQuestionFormFromQuestion(question: PalaceQuizQuestion): QuestionFormState {
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

export function buildDraftFromForm(form: QuestionFormState): PalaceQuizQuestionDraft {
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

export function readPersistedViewMode(): PalaceQuizViewMode {
  if (typeof window === 'undefined') return 'single'
  return window.localStorage.getItem(QUIZ_VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'single'
}

export function readInitialTab(searchParams: URLSearchParams): PalaceQuizTabKey {
  const requested = searchParams.get('tab')
  return requested === 'manage' || requested === 'generate' ? requested : 'practice'
}

export function getQuestionOwnershipLabel(question: PalaceQuizQuestion) {
  if (question.classified_chapter?.name) {
    return `章节题 · ${question.classified_chapter.name}`
  }
  if (question.segments?.length) {
    return `学习组 · ${question.segments.map((segment) => segment.name).join('、')}`
  }
  return '大宫殿'
}

export function getQuestionSourceLabel(sourceMeta?: PalaceQuizSourceMeta | null) {
  if (!sourceMeta) return '手工录入'
  return QUESTION_SOURCE_LABELS[sourceMeta.source_kind] ?? '手工录入'
}

export function formatResolvedAiSteps(
  steps:
    | Array<{
        scenario_key: string
        model_label?: string | null
      }>
    | {
        generation?: { model_label?: string | null } | null
        pairing?: { model_label?: string | null } | null
        review?: { model_label?: string | null } | null
      }
    | null
    | undefined,
) {
  if (!steps) return ''
  const normalizedSteps = Array.isArray(steps)
    ? steps
    : Object.entries(steps)
        .filter(([, meta]) => Boolean(meta))
        .map(([scenario_key, meta]) => ({
          scenario_key,
          model_label: meta?.model_label ?? null,
        }))
  if (!normalizedSteps.length) return ''
  return normalizedSteps
    .map((step) => {
      const label = step.model_label?.trim()
      return label ? `${step.scenario_key}: ${label}` : step.scenario_key
    })
    .join(' / ')
}

export function getQuestionTypeLabel(questionType: PalaceQuizQuestionType) {
  return QUESTION_TYPE_LABELS[questionType]
}

export function canManuallyEditQuestion(questionType: PalaceQuizQuestionType) {
  return questionType === 'multiple_choice' || questionType === 'short_answer'
}

export function collectAllowedChapterIds(
  nodes: ChapterTreeNode[],
  explicitIds: Set<number>,
  ancestorSelected: boolean,
  collector: Set<number>,
) {
  const walk = (items: ChapterTreeNode[], parentAllowed: boolean) => {
    let branchHasAllowedNode = false
    for (const node of items) {
      const selfAllowed = parentAllowed || explicitIds.has(node.id)
      const childHasAllowedNode = walk(node.children || [], selfAllowed)
      const shouldAllow = selfAllowed || childHasAllowedNode
      if (shouldAllow) {
        collector.add(node.id)
        branchHasAllowedNode = true
      }
    }
    return branchHasAllowedNode
  }
  walk(nodes, ancestorSelected)
}

export function findChapterPath(
  nodes: ChapterTreeNode[],
  chapterId: number,
  trail: ChapterTreeNode[] = [],
): ChapterTreeNode[] | null {
  for (const node of nodes) {
    const nextTrail = [...trail, node]
    if (node.id === chapterId) return nextTrail
    const nested = findChapterPath(node.children || [], chapterId, nextTrail)
    if (nested) return nested
  }
  return null
}

export function resolveChapterInfoFromTrees(
  trees: SubjectTreePayload[],
  chapterId: number | null,
) {
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

export function buildChapterSummary(info: { subjectName: string; path: ChapterTreeNode[] } | null) {
  if (!info) return '尚未选择题目所属章节'
  return `${info.subjectName} / ${info.path.map((item) => item.name).join(' / ')}`
}

