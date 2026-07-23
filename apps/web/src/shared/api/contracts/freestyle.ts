import type { PalaceQuizQuestion, PalaceQuizQuestionType } from './quiz'

export type FreestyleRange =
  | 'all'
  | 'due'
  | 'needs_practice'
  | 'specific_palaces'
  | 'wrong'

export type FreestyleContentType =
  | 'quiz_question'
  | 'review'
  | 'practice'
  | 'english'
  | 'english_reading'

export type FreestyleDuePolicy =
  | 'due_first_then_expand'
  | 'due_only'
  | 'all_content_due_weighted'

export type FreestylePalaceOrder = 'finish_palace_then_next' | 'interleave_palaces'

export type FreestyleWithinPalaceOrder = 'tree_order' | 'deterministic_shuffle'

export interface FreestyleFeedConfig {
  content: {
    mindmap_branch: boolean
    /** Anki-style front/back cards from marked palace nodes. */
    anki_card: boolean
    quiz_question: boolean
  }
  weights: {
    mindmap_branch: number
    anki_card: number
    quiz_question: number
  }
  palace_order: FreestylePalaceOrder
  within_palace_order: FreestyleWithinPalaceOrder
  due_policy: FreestyleDuePolicy
  node_limit: number
  queue_length: number
  specific_palace_ids: number[]
  question_type: FreestyleQuestionTypeFilter
  weak_quiz_priority: boolean
  /** When true, formal nodes due later today (local calendar) enter freestyle before clock due. */
  include_calendar_today_due: boolean
  seed: number
}

export interface FreestyleContextPathItem {
  uid: string
  text: string
}

export type FreestyleMindMapPresentation = 'palace' | 'anki'

export interface FreestyleMindMapBranchCard {
  id: string
  type: 'mindmap_branch' | 'anki_card'
  content_type: 'mindmap_branch' | 'anki_card'
  /** How the freestyle card should render: palace flip vs Anki front/back. */
  presentation?: FreestyleMindMapPresentation
  palace_id: number
  palace_title?: string
  branch_uid: string
  context_path: FreestyleContextPathItem[]
  ratable_node_uids: string[]
  due_node_uids: string[]
  /** Anki: front node uid when presentation is anki. */
  anki_front_uid?: string
  /** Anki: back node uids for multi-placeholder reveal. */
  anki_back_uids?: string[]
  node_count: number
  over_limit_delta: number
  due_node_count?: number
  selection_reason?: string
  phase?: string
  palace_context?: FreestylePalaceContext | null
}

export type FreestyleActionKind =
  | 'review'
  | 'practice'
  | 'segment_practice'
  | 'english'
  | 'english_reading'

export interface FreestyleChapterContext {
  id: number
  name: string
  subject_id: number | null
  parent_id?: number | null
  subject?: {
    id: number
    name: string
    color?: string
  } | null
}

export interface FreestylePalaceContext {
  id: number
  title: string
  resolved_title?: string
  subject?: {
    id: number
    name: string
    color?: string
  } | null
  primary_chapter?: FreestyleChapterContext | null
  parent_chapter?: FreestyleChapterContext | null
  needs_practice?: boolean
}

export interface FreestyleSegmentContext {
  id: number
  palace_id: number
  name: string
  sort_order?: number
  needs_practice?: boolean
}

export interface FreestyleQuizCard {
  id: string
  type: 'quiz_question'
  content_type: 'quiz_question'
  question: PalaceQuizQuestion
  palace_context: FreestylePalaceContext
  segment_contexts?: FreestyleSegmentContext[]
  chapter_context?: FreestyleChapterContext | null
  group_key: string
}

export interface FreestyleActionCard {
  id: string
  type: 'action'
  content_type: Exclude<FreestyleContentType, 'quiz_question'>
  action_kind: FreestyleActionKind
  title: string
  subtitle: string
  href: string
  priority: number
  reason: string
  palace_context?: FreestylePalaceContext | null
  schedule_id?: number
  segment_id?: number
  segment_name?: string
  mini_palace_id?: number
  mini_palace_name?: string
  course?: Record<string, unknown>
  material?: Record<string, unknown>
}

export type FreestyleCard = FreestyleQuizCard | FreestyleActionCard | FreestyleMindMapBranchCard

export interface FreestyleFeedResponse {
  cards: FreestyleCard[]
  counts: Record<string, number>
  generated_at: string
}

export interface FreestyleQueueBuildRequest {
  operation_id: string
  config: FreestyleFeedConfig
  completed_ids?: string[]
  hidden_ids?: string[]
}

export interface FreestyleQueueBuildResponse {
  operation_id: string
  config: FreestyleFeedConfig
  cards: FreestyleCard[]
  phase_stats: Record<string, number | string>
  counts: {
    mindmap_branch: number
    quiz_question: number
    total: number
  }
}

export type FreestyleQuestionTypeFilter = PalaceQuizQuestionType | 'all'

export type FreestyleHistoryMode = 'today' | 'free'

export interface FreestyleQuizAttemptRecord {
  id: number
  question_id: number | null
  palace_id: number | null
  palace_title: string
  mini_palace_id: number | null
  mini_palace_name: string
  chapter_id: number | null
  chapter_name: string
  mode: FreestyleHistoryMode
  question_type: PalaceQuizQuestionType | string
  stem_snapshot: string
  answer_payload: Record<string, unknown>
  is_correct: boolean | null
  created_at: string | null
}

export interface FreestyleAiExplanationRecord {
  id: number
  question_id: number | null
  palace_id: number | null
  palace_title: string
  mini_palace_id: number | null
  mini_palace_name: string
  chapter_id: number | null
  chapter_name: string
  question_type: PalaceQuizQuestionType | string
  stem_snapshot: string
  user_question: string
  explanation_text: string
  ai_call_log_id: string | null
  created_at: string | null
}

export interface FreestyleHistorySummary {
  stored: {
    attempt_count: number
    explanation_count: number
  }
  legacy_quiz: {
    question_count: number
    attempted_question_count: number
    attempt_count: number
    correct_count: number
    incorrect_count: number
  }
  legacy_ai_logs: {
    total_count: number
    explanation_count: number
    short_answer_feedback_count: number
  }
}

export interface WrongQuestionItem {
  question: PalaceQuizQuestion
  palace_id: number | null
  palace_title: string
  incorrect_count: number
  correct_count: number
  attempt_count: number
  last_wrong_at: string | null
}

export interface WrongQuestionsResponse {
  total: number
  items: WrongQuestionItem[]
}

export interface CreateFreestyleQuizAttemptPayload {
  question_id: number
  palace_id?: number | null
  palace_title?: string
  mini_palace_id?: number | null
  mini_palace_name?: string
  chapter_id?: number | null
  chapter_name?: string
  mode: FreestyleHistoryMode
  question_type: PalaceQuizQuestionType | string
  stem_snapshot: string
  answer_payload: Record<string, unknown>
  is_correct?: boolean | null
}

export interface CreateFreestyleAiExplanationPayload {
  question_id: number
  palace_id?: number | null
  palace_title?: string
  mini_palace_id?: number | null
  mini_palace_name?: string
  chapter_id?: number | null
  chapter_name?: string
  question_type: PalaceQuizQuestionType | string
  stem_snapshot: string
  user_question: string
  explanation_text: string
  ai_call_log_id?: string | null
}
