import type { PalaceQuizQuestionType } from './quiz'

export * from './freestyle-round-progress'

export type FreestyleRange =
  | 'all'
  | 'due'
  | 'specific_palaces'
  | 'wrong'

export type FreestyleContentType =
  | 'quiz_question'
  | 'review'
  | 'english'

/** Mutually exclusive freestyle progress buckets (multi-select). */
export type FreestylePalaceOrder = 'finish_palace_then_next' | 'interleave_palaces' | 'exam_priority'

/** Where never-passed (new) units sit relative to review units. */
export type FreestyleNewPlacement = 'new_first' | 'review_first' | 'ratio'

/** Review cards per new card when new_placement is ratio. */
export type FreestyleReviewNewRatio = 1 | 2 | 4

/** Which review units a round may serve: never-passed 新学, or already-passed 复习. */
export type FreestyleLearnScope = 'new' | 'review'

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

/** 刷题出题顺序：未学过的先出，或整体随机。 */
export type FreestyleQuizOrder = 'new_first' | 'random'

/** Toolbar 做题 pool: round units + their root paths (default), or the whole palace. */
export type FreestyleOverlayQuestionRange = 'round_units' | 'whole_palace'

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

/** Blank score: hide, or follow the weakest reviewed ancestor. Display only. */
export type FreestyleOverlayRatingInherit = 'blank' | 'lowest_reviewed'

export type FreestyleSubjectScope = 'all' | 'english' | 'non_english'

/** The first decision in the freestyle configuration flow. */
export type FreestyleTrainingMode = 'memory_palace' | 'quiz' | 'english' | 'mixed'

/** Content streams available inside the mixed training direction. */
export type FreestyleTrainingStream = Exclude<FreestyleTrainingMode, 'mixed'>

/** Ordering inside one palace after the palace itself has been selected. */
export type FreestyleUnitOrder = 'structured' | 'random'

/** How active streams are composed for a mixed round. */
export type FreestyleMixStrategy = 'ratio' | 'random' | 'sequential'

export type FreestyleQuestionTypeFilter = PalaceQuizQuestionType | 'all'

export interface FreestyleStreamScope {
  specific_palace_ids: number[]
  /**
   * Palaces added from the round's left directory. Widens the selection above
   * instead of replacing it, and persists into later rounds.
   */
  extra_palace_ids?: number[]
  subject_scope: FreestyleSubjectScope
  /** Empty means no subject filter (all subjects). Non-empty is the source of truth over subject_scope. */
  subject_ids: number[]
}

export interface FreestylePalaceStreamConfig extends FreestyleStreamScope {
  palace_order: FreestylePalaceOrder
  unit_order: FreestyleUnitOrder
}

export interface FreestyleQuizStreamConfig extends FreestyleStreamScope {
  question_type: FreestyleQuestionTypeFilter
  mastery_buckets: FreestyleQuizMasteryBucket[]
  quiz_scope: FreestyleQuizScope
  order: FreestyleQuizOrder
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
  /** Deterministic ordering seed. Kept under advanced settings in the UI. */
  seed: number
  /** Where never-passed units sit relative to review units. */
  new_placement: FreestyleNewPlacement
  /** Review cards per new card; only read when new_placement is ratio. */
  review_new_ratio: FreestyleReviewNewRatio
  /** 新学 / 复习 pool. Empty never reaches the queue; both means everything due. */
  learn_scope: FreestyleLearnScope[]

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
  /** Blank-score display. Default lowest_reviewed. Not a queue-construction field. */
  overlay_rating_inherit: FreestyleOverlayRatingInherit
}

export * from './freestyle-cards'
