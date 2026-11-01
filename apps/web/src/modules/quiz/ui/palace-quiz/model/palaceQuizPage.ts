import type {
  PalaceSegmentSummary,
  PalaceQuizQuestion,
  PalaceQuizQuestionType,
  PalaceQuizSourceMeta,
} from '@/shared/api/contracts'

// Question form state, its builders and `canManuallyEditQuestion` moved to the
// Quiz entity so the do-question overlays edit through the same model. Kept
// re-exported here for the Palace Quiz management card's existing imports.
export {
  buildDraftFromForm,
  buildEmptyQuestionForm,
  buildManualSourceMeta,
  buildQuestionFormFromQuestion,
  canManuallyEditQuestion,
  questionCorrectOptionIds,
  type QuizQuestionFormState,
} from '@/modules/quiz/domain/quiz-entity/model/quizQuestionForm'
export type { QuizQuestionFormState as QuestionFormState } from '@/modules/quiz/domain/quiz-entity/model/quizQuestionForm'

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

export const QUIZ_VIEW_MODE_STORAGE_KEY = 'memory_anki_palace_quiz_view_mode'

const QUESTION_SOURCE_LABELS: Record<string, string> = {
  image_batch: '多图生成',
  image_single: '单图生成',
  text_files: '文本生成',
  mindmap_review: '脑图复习生成',
  ai_chapter_generated: 'AI生成',
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

export function readPersistedViewMode(): PalaceQuizViewMode {
  if (typeof window === 'undefined') return 'single'
  return window.localStorage.getItem(QUIZ_VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'single'
}

export function readInitialTab(searchParams: URLSearchParams): PalaceQuizTabKey {
  const requested = searchParams.get('tab')
  return requested === 'manage' ? 'manage' : 'practice'
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

export function getQuestionTypeLabel(questionType: PalaceQuizQuestionType) {
  return QUESTION_TYPE_LABELS[questionType]
}
