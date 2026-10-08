import type { PalaceQuizQuestion, PalaceQuizQuestionType } from './quiz'

export type FreestyleRange =
  | 'all'
  | 'due'
  | 'specific_palaces'
  | 'wrong'

export type FreestyleContentType =
  | 'quiz_question'
  | 'review'
  | 'english'
  | 'english_reading'

export type FreestyleDuePolicy =
  | 'due_first_then_expand'
  | 'due_only'
  | 'all_content_due_weighted'

/** Mutually exclusive freestyle progress buckets (multi-select). */
export type FreestylePalaceOrder = 'finish_palace_then_next' | 'interleave_palaces' | 'exam_priority'

/** How palace-side cards and quiz cards are ordered relative to each other. */
export type FreestyleMixMode =
  | 'mindmap_only'
  | 'quiz_only'
  | 'sequential_map_quiz'
  | 'sequential_quiz_map'
  | 'ratio'
  | 'random'

/** Where node-bound quizzes sit relative to their mind-map units. */
export type FreestyleBoundQuizPlacement =
  | 'follow_unit'
  | 'into_mix'
  | 'quiz_stream'

/** Multi-select mastery buckets that may enter the freestyle quiz pool. */
export type FreestyleQuizMasteryBucket = 'unseen' | 'weak' | 'reinforce' | 'stable'

/**
 * How quiz cards are drawn across palaces (independent of palace-side order).
 * - cross_palace_random: shuffle all in-pool quizzes across palaces
 * - single_palace_random: finish one palace's quiz pool (shuffled) before the next
 */
export type FreestyleQuizScope = 'cross_palace_random' | 'single_palace_random'

/** Toolbar 做题 overlay membership: due questions vs all questions in the saved palace range. */
export type FreestyleOverlayQuestionRange = 'due' | 'all'

/** Overlay 做题 groups: 客观 is every type except short_answer; 主观 is short_answer. */
export type FreestyleOverlayQuestionKind = 'objective' | 'subjective'

/** Overlay 做题 type order when both 客观 and 主观 are selected. */
export type FreestyleOverlayTypeOrder =
  | 'interleave'
  | 'objective_then_subjective'
  | 'subjective_then_objective'

/**
 * Overlay nesting when palace-by-palace draw and sequential types are both on.
 * Hidden unless 一个宫殿刷完再换 and a sequential type order are selected.
 */
export type FreestyleOverlayTypePalaceNesting = 'palace_then_type' | 'type_then_palace'

export type FreestyleSubjectScope = 'all' | 'english' | 'non_english'

/** The first decision in the freestyle configuration flow. */
export type FreestyleTrainingMode = 'memory_palace' | 'quiz' | 'english' | 'mixed'

/** Content streams available inside the mixed training direction. */
export type FreestyleTrainingStream = Exclude<FreestyleTrainingMode, 'mixed'>

/** Ordering inside one palace after the palace itself has been selected. */
export type FreestyleUnitOrder = 'structured' | 'random'

/** How active streams are composed for a mixed round. */
export type FreestyleMixStrategy = 'ratio' | 'random' | 'sequential'

export interface FreestyleStreamScope {
  specific_palace_ids: number[]
  subject_scope: FreestyleSubjectScope
  /** Empty means no subject filter (all subjects). Non-empty is the source of truth over subject_scope. */
  subject_ids: number[]
}

export interface FreestylePalaceStreamConfig extends FreestyleStreamScope {
  due_policy: FreestyleDuePolicy
  palace_order: FreestylePalaceOrder
  unit_order: FreestyleUnitOrder
}

export interface FreestyleQuizStreamConfig extends FreestyleStreamScope {
  question_type: FreestyleQuestionTypeFilter
  mastery_buckets: FreestyleQuizMasteryBucket[]
  quiz_scope: FreestyleQuizScope
  overlay_question_range: FreestyleOverlayQuestionRange
  weak_priority: boolean
}

export interface FreestyleTrainingStreams {
  memory_palace: FreestylePalaceStreamConfig
  quiz: FreestyleQuizStreamConfig
  english: FreestylePalaceStreamConfig
}

export interface FreestyleTrainingMix {
  strategy: FreestyleMixStrategy
  ratios: Record<FreestyleTrainingStream, number>
}

export interface FreestyleMixRatio {
  /** Palace-side cards per cycle (mindmap + anki stream). */
  mindmap: number
  /** Quiz cards per cycle. */
  quiz: number
}

export interface FreestyleFeedConfig {
  /** New information architecture. Old fields below are compatibility-only. */
  training_mode: FreestyleTrainingMode
  /** Non-empty only when training_mode is mixed; sanitized to at least two streams. */
  mixed_modes: FreestyleTrainingStream[]
  /** Each training stream owns its source range and its own relevant options. */
  streams: FreestyleTrainingStreams
  /** Used only for mixed rounds. */
  mix: FreestyleTrainingMix
  /** One total for every direction. Candidate shortfall never creates duplicates. */
  queue_length: number
  /** Deterministic ordering seed. Kept under advanced settings in the UI. */
  seed: number

  /**
   * Compatibility projection for v1 local preferences and callers during the
   * configuration migration. New UI and queue code must read the fields above.
   */
  content: {
    mindmap_branch: boolean
    /** Retired from new freestyle rounds; always false after sanitization. */
    anki_card: boolean
    quiz_question: boolean
  }
  /**
   * Legacy relative weights. Prefer mix_ratio for map-vs-quiz interleave.
   * Still kept so older clients / stored prefs remain valid.
   */
  weights: {
    mindmap_branch: number
    anki_card: number
    quiz_question: number
  }
  /**
   * Primary control for palace vs quiz appearance.
   * Default ratio approximates previous weight-based interleave.
   */
  mix_mode: FreestyleMixMode
  /** Used when mix_mode is ratio (N palace-side : M quiz). */
  mix_ratio: FreestyleMixRatio
  /**
   * How quizzes bound to nodes are placed relative to units.
   * Default `into_mix` so mix_ratio actually includes bound quizzes.
   */
  bound_quiz_placement: FreestyleBoundQuizPlacement
  palace_order: FreestylePalaceOrder
  /**
   * Which mind-map unit pool fills after due selection.
   * Quiz pool entry is controlled by quiz_mastery_buckets (not this field).
   */
  due_policy: FreestyleDuePolicy
  /**
   * Which mastery labels may enter the quiz stream (multi-select).
   * Empty after sanitize is replaced by the default buckets.
   */
  quiz_mastery_buckets: FreestyleQuizMasteryBucket[]
  /** Cross-palace vs single-palace quiz draw order. */
  quiz_scope: FreestyleQuizScope
  specific_palace_ids: number[]
  subject_scope: FreestyleSubjectScope
  subject_ids: number[]
  question_type: FreestyleQuestionTypeFilter
  /** Pool-internal sort only; does not decide membership (see quiz_mastery_buckets). */
  weak_quiz_priority: boolean
  /**
   * Freestyle toolbar 做题 overlay: after the learner confirms palace order once,
   * later clicks skip the setup panel. Quiz draw order still lives on streams.quiz.quiz_scope.
   */
  overlay_quiz_setup_done: boolean
  overlay_question_range: FreestyleOverlayQuestionRange
  /**
   * Toolbar 做题 overlay: which of 客观 / 主观 to include.
   * Empty after sanitize becomes both. Independent of streams.quiz.question_type.
   */
  overlay_question_kinds: FreestyleOverlayQuestionKind[]
  /** Toolbar 做题 overlay: mix 客观/主观 or finish one group first. Default interleave. */
  overlay_type_order: FreestyleOverlayTypeOrder
  /**
   * Toolbar 做题 overlay: palace-first vs type-first when
   * quiz_scope is single_palace_random and type order is sequential.
   */
  overlay_type_palace_nesting: FreestyleOverlayTypePalaceNesting
}

export interface FreestyleContextPathItem {
  uid: string
  text: string
}

interface FreestylePalaceCardBase {
  id: string
  palace_id: number
  /** Resolved exam importance 1-3, attached by the queue builder. */
  exam_stars?: number
  palace_title?: string
  anchor_uid: string
  context_path: FreestyleContextPathItem[]
  node_uids: string[]
  node_count: number
  phase?: string
  palace_context?: FreestylePalaceContext | null
  source_card_id?: string
  occurrence_kind?: 'source' | 'retry'
  retry_attempt?: number
  retry_after_cards?: number
}

export interface FreestyleReviewUnitCard extends FreestylePalaceCardBase {
  type: 'mindmap_branch'
  content_type: 'mindmap_branch'
  presentation?: 'palace'
  unit_id: string
  unit_revision: number
}

export type FreestyleMindMapBranchCard = FreestyleReviewUnitCard

export type FreestyleActionKind =
  | 'review'
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
}

export interface FreestyleSegmentContext {
  id: number
  palace_id: number
  name: string
  sort_order?: number
}

export interface FreestyleQuizCard {
  id: string
  type: 'quiz_question'
  exam_stars?: number
  content_type: 'quiz_question'
  question: PalaceQuizQuestion
  palace_context: FreestylePalaceContext
  segment_contexts?: FreestyleSegmentContext[]
  chapter_context?: FreestyleChapterContext | null
  group_key: string
  source_card_id?: string
  occurrence_kind?: 'source' | 'retry'
  retry_attempt?: number
  retry_after_cards?: number
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
  source_card_id?: string
  occurrence_kind?: 'source' | 'retry'
  retry_attempt?: number
  retry_after_cards?: number
}

/**
 * Frontend-only yellow boundary hint: sits immediately before the queue's
 * first formal review unit (never at index 0) and is stripped before any
 * server round-plan write.
 *
 * The optional palace/retry fields exist only so the shared feed-card union
 * keeps its cross-member property set; they are always absent at runtime.
 */
export interface FreestyleReviewHintCard {
  id: string
  type: 'review_hint'
  content_type: 'review_hint'
  text: string
  palace_context?: FreestylePalaceContext | null
  source_card_id?: string
  occurrence_kind?: 'source' | 'retry'
  retry_attempt?: number
  retry_after_cards?: number
  anchor_uid?: string
}

export type FreestyleCard =
  | FreestyleQuizCard
  | FreestyleActionCard
  | FreestyleMindMapBranchCard
  | FreestyleReviewHintCard

export const FREESTYLE_REVIEW_HINT_ID = 'review_hint:formal_review'
export const FREESTYLE_REVIEW_HINT_TEXT = '下一张：正式复习'

export function isReviewHintCard(card: Pick<FreestyleCard, 'type'> | null | undefined): card is FreestyleReviewHintCard {
  return card?.type === 'review_hint'
}

export function isReviewHintId(id: string | null | undefined): boolean {
  return String(id || '').trim() === FREESTYLE_REVIEW_HINT_ID
}

export interface FreestyleFeedResponse {
  cards: FreestyleCard[]
  counts: Record<string, number>
  generated_at: string
}

export type FreestyleRoundOccurrenceStatus = 'pending' | 'inserted' | 'completed' | 'cancelled'

export interface FreestyleRoundOriginalCard {
  card_id: string
  unit_id: string
  unit_revision: number
  kind: string
  palace_id: number | null
  palace_title: string
  label: string
  entered_on?: string
}

export interface FreestyleRoundOccurrence {
  occurrence_id: string
  source_card_id: string
  source_unit_id: string
  retry_attempt: number
  rating: number | null
  insert_target_index: number
  status: FreestyleRoundOccurrenceStatus
  encounter_id: string
  entered_on?: string
}

export interface FreestyleRoundPlanPayload {
  original_cards: FreestyleRoundOriginalCard[]
  presented_ids: string[]
  current_card_id: string | null
  current_index: number
  completed_ids: string[]
  excluded_ids: string[]
  compressed_ids?: string[]
  /** Confirmed 小结算 pages. The closing 大结算 reads these after cards leave the feed. */
  partial_settlements?: unknown[]
  today?: string
  occurrences: FreestyleRoundOccurrence[]
  encounters: Record<string, {
    encounter_id: string
    status: string
    unit_revision: number
    /** Concrete 1–4 score. Absent means completion without a displayed rating. */
    rating?: number | null
  }>
  overlay_quiz?: FreestyleOverlayQuizState
  learning_time?: FreestyleRoundLearningTimePayload
}

export interface FreestyleRoundLearningTimePayload {
  unit_seconds: number
  quiz_seconds: number
  lookup_seconds: number
  backfilled?: boolean
  by_palace?: Record<string, {
    unit_seconds: number
    quiz_seconds: number
    lookup_seconds: number
  }>
}

export interface FreestyleLearningTimeAdd {
  bucket: 'unit' | 'quiz' | 'lookup'
  seconds: number
  palace_id?: number | null
}

export interface FreestyleLearningInterval {
  interval_id: string
  session_id: string
  started_at: string
  ended_at: string
  bucket: 'unit' | 'quiz' | 'lookup'
  palace_id?: number | null
  client_source: 'desktop' | 'pwa' | 'unknown'
}

export interface FreestyleLearningTimeRequest {
  operation_id: string
  expected_version: number
  intervals?: FreestyleLearningInterval[]
  /** Historical clients without actual interval boundaries. */
  adds?: FreestyleLearningTimeAdd[]
}

export interface FreestyleLearningTimeBackfillRequest {
  operation_id: string
  expected_version: number
}

// The 做题 scope report types live in `freestyleOverlayScope.ts`: one owner, one
// incident history, and this file's size budget.
export type {
  FreestyleOverlayScopePalace,
  FreestyleOverlayScopePalaces,
  FreestyleOverlayScopeReason,
} from './freestyleOverlayScope'
import type { FreestyleOverlayScopePalaces } from './freestyleOverlayScope'

export interface FreestyleOverlayQuizState {
  scope_signature: string
  quiz_scope: FreestyleQuizScope
  seed: number
  question_ids: number[]
  current_index: number
  completed_ids: number[]
  states: Record<string, Record<string, unknown>>
  limit_reached: boolean
  candidate_count: number
  question_palace_ids?: Record<string, number>
  /** Unfiltered 客观/主观 counts for the current round palace set. */
  kind_counts?: Record<FreestyleOverlayQuestionKind, number>
  /** Per-palace scope report. See `FreestyleOverlayScopePalaces`. */
  scope_palaces?: FreestyleOverlayScopePalaces
  /**
   * Question id → the weakest this-round rating (1–4) among that question's
   * bound knowledge points. Absent means either the question binds no knowledge
   * point in this round, or none of them were rated this round — both render as
   * 「本轮尚未复习」, never as a fabricated score.
   */
  question_node_ratings?: Record<string, number>
  parked?: {
    question_ids: number[]
    completed_ids: number[]
    states: Record<string, Record<string, unknown>>
  }
  /** Subjective (or any) questions taken out of this round's 做题 queue. */
  excluded_ids?: number[]
}

export interface FreestyleRoundQuestionRatingsResponse {
  round_id: string
  /**
   * Question id → the weakest this-round rating (1–4) among that question's
   * bound knowledge points. Covers every question bound to this round's palaces,
   * not just the 做题 pool, so 关联题目 can badge a question the pool filtered out.
   * A question absent here was not rated this round.
   */
  question_node_ratings: Record<string, number>
}

export interface FreestyleRoundStatePayload {
  round_id: string
  scope_key: string
  status: 'active' | 'completed'
  version: number
  plan_version: number
  config: FreestyleFeedConfig | Record<string, unknown>
  plan: FreestyleRoundPlanPayload
  current_card_id: string | null
  last_operation_id: string | null
  updated_at: string | null
  conflict: boolean
  duplicate: boolean
  workspace?: 'primary' | 'secondary' | `p${number}`
  /**
   * Deliberately absent: `cleared_review_palace_ids`.
   *
   * It used to ship a palace-clearance answer (skip/exclude counted as handled)
   * that no client ever read, while the chapter banner computed the opposite
   * rule locally ("skip / exclude do not count"). Two answers to one question,
   * with the shipped one unused — reading it later would have silently changed
   * the banner. See docs/incidents/0002-quiz-scope-two-owners.md §6.
   */
  learning_backfill_applied?: boolean
}

export interface FreestyleRoundActiveRequest {
  operation_id: string
  scope_key: string
  config: FreestyleFeedConfig
  cards?: FreestyleCard[]
  round_id?: string
  workspace?: 'primary' | 'secondary' | `p${number}`
  replan?: boolean
}

export interface FreestyleRoundActionRequest {
  operation_id: string
  expected_version: number
  action:
    | 'set_cursor'
    | 'leave_card'
    | 'skip'
    | 'complete'
    | 'uncomplete'
    | 'exclude'
    | 'restore'
    | 'compress_completed'
    | 'bind_cards'
    | 'set_encounter'
  card_id?: string
  occurrence_id?: string
  encounter_id?: string
  cards?: FreestyleCard[]
  /** Snapshot shown on the 小结算 page. Persisted with compress_completed. */
  partial_settlement?: Record<string, unknown>
}

export interface FreestyleOverlayQuizEnsureRequest {
  operation_id: string
  expected_version: number
  config?: FreestyleFeedConfig
}

export interface FreestyleOverlayQuizProgressRequest {
  operation_id: string
  expected_version: number
  current_index: number
  completed_ids: number[]
  states: Record<string, Record<string, unknown>>
}

export interface FreestyleOverlayQuizDropPalacesRequest {
  operation_id: string
  expected_version: number
  palace_ids: number[]
}

export interface FreestyleRoundRatingRequest {
  operation_id: string
  expected_version: number
  card_id: string
  occurrence_id?: string
  encounter_id: string
  rating: number
  study_session_id: string
  unit_id: string
  unit_revision: number
  palace_batch?: {
    palace_id: number
    current?: {
      study_session_id: string
      unit_id: string
      unit_revision: number
      encounter_id: string
    }
    exclude_unit_ids?: string[]
    include_unit_ids?: string[]
  } | null
}

export interface FreestyleQueueBuildRequest {
  operation_id: string
  round_id: string
  config: FreestyleFeedConfig
  completed_ids?: string[]
  hidden_ids?: string[]
  /** Cold start only: return a prefix so study can begin before the tail arrives. */
  study_window?: boolean
}

export interface FreestyleQueueBuildResponse {
  operation_id: string
  round_id?: string
  config: FreestyleFeedConfig
  cards: FreestyleCard[]
  phase_stats: Record<string, number | string>
  round_meta: {
    candidate_count: number
    scheduled_count: number
    queue_limit: number
    limit_reached: boolean
    /** Cold-start prefix is shorter than the full ordered queue. Not a quiz cap. */
    tail_pending?: boolean
    /** Today's due review units left out of this round, keyed by palace id. */
    palace_leftover_due?: Record<string, number>
  }
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
