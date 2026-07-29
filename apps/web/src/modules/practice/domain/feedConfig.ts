import type {
  FreestyleBoundQuizPlacement,
  FreestyleDuePolicy,
  FreestyleFeedConfig,
  FreestyleMixMode,
  FreestyleMixRatio,
  FreestylePalaceOrder,
  FreestyleQuestionTypeFilter,
  FreestyleQuizMasteryBucket,
  FreestyleQuizScope,
} from '@/shared/api/contracts'

export const FREESTYLE_FEED_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.feed-config.v1'

export const FREESTYLE_MIX_MODES: FreestyleMixMode[] = [
  'mindmap_only',
  'quiz_only',
  'sequential_map_quiz',
  'sequential_quiz_map',
  'ratio',
  'random',
]

export const FREESTYLE_BOUND_QUIZ_PLACEMENTS: FreestyleBoundQuizPlacement[] = [
  'follow_unit',
  'into_mix',
  'quiz_stream',
]

export const FREESTYLE_QUIZ_MASTERY_BUCKETS: FreestyleQuizMasteryBucket[] = [
  'unseen',
  'weak',
  'reinforce',
  'stable',
]

export const FREESTYLE_QUIZ_SCOPES: FreestyleQuizScope[] = [
  'cross_palace_random',
  'single_palace_random',
]

/** Default: new + weak + reinforce (exclude already-stable). */
export const DEFAULT_QUIZ_MASTERY_BUCKETS: FreestyleQuizMasteryBucket[] = [
  'unseen',
  'weak',
  'reinforce',
]

export const DEFAULT_FREESTYLE_FEED_CONFIG: FreestyleFeedConfig = {
  content: {
    mindmap_branch: true,
    anki_card: true,
    quiz_question: true,
  },
  weights: {
    mindmap_branch: 2,
    anki_card: 2,
    quiz_question: 1,
  },
  mix_mode: 'ratio',
  mix_ratio: {
    mindmap: 2,
    quiz: 1,
  },
  // Bound quizzes participate in N:M so mix_ratio is not an empty free stream.
  bound_quiz_placement: 'into_mix',
  palace_order: 'finish_palace_then_next',
  // Mind-map cards are formal-due only; quiz membership uses quiz_mastery_buckets.
  due_policy: 'due_only',
  quiz_mastery_buckets: [...DEFAULT_QUIZ_MASTERY_BUCKETS],
  quiz_scope: 'cross_palace_random',
  queue_length: 20,
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
  seed: 17,
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function asInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function asIdList(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  const result: number[] = []
  value.forEach((item) => {
    const id = Number(item)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    result.push(id)
  })
  return result
}

function asPalaceOrder(value: unknown): FreestylePalaceOrder {
  return value === 'interleave_palaces' ? 'interleave_palaces' : 'finish_palace_then_next'
}

function asDuePolicy(value: unknown): FreestyleDuePolicy {
  if (value === 'due_first_then_expand' || value === 'all_content_due_weighted') return value
  return 'due_only'
}

function asQuestionType(value: unknown): FreestyleQuestionTypeFilter {
  const allowed: FreestyleQuestionTypeFilter[] = [
    'all',
    'multiple_choice',
    'true_false',
    'fill_blank',
    'matching',
    'ordering',
    'categorization',
    'short_answer',
  ]
  return allowed.includes(value as FreestyleQuestionTypeFilter)
    ? (value as FreestyleQuestionTypeFilter)
    : 'all'
}

function asMixMode(value: unknown): FreestyleMixMode | null {
  return FREESTYLE_MIX_MODES.includes(value as FreestyleMixMode)
    ? (value as FreestyleMixMode)
    : null
}

function asBoundPlacement(value: unknown): FreestyleBoundQuizPlacement {
  // Missing -> new default into_mix (bound quizzes count toward mix_ratio).
  if (value === undefined || value === null || value === '') {
    return DEFAULT_FREESTYLE_FEED_CONFIG.bound_quiz_placement
  }
  return FREESTYLE_BOUND_QUIZ_PLACEMENTS.includes(value as FreestyleBoundQuizPlacement)
    ? (value as FreestyleBoundQuizPlacement)
    : DEFAULT_FREESTYLE_FEED_CONFIG.bound_quiz_placement
}

function asQuizScope(value: unknown): FreestyleQuizScope {
  return value === 'single_palace_random' ? 'single_palace_random' : 'cross_palace_random'
}

/**
 * Multi-select mastery buckets. Empty / invalid -> default.
 * Legacy: when field missing, map due_policy expand modes to include stable.
 */
function asQuizMasteryBuckets(
  value: unknown,
  duePolicy: FreestyleDuePolicy,
  hasExplicitField: boolean,
): FreestyleQuizMasteryBucket[] {
  if (Array.isArray(value)) {
    const seen = new Set<FreestyleQuizMasteryBucket>()
    const result: FreestyleQuizMasteryBucket[] = []
    value.forEach((item) => {
      if (!FREESTYLE_QUIZ_MASTERY_BUCKETS.includes(item as FreestyleQuizMasteryBucket)) return
      const scope = item as FreestyleQuizMasteryBucket
      if (seen.has(scope)) return
      seen.add(scope)
      result.push(scope)
    })
    if (result.length > 0) return result
  }
  if (!hasExplicitField && (duePolicy === 'due_first_then_expand' || duePolicy === 'all_content_due_weighted')) {
    return [...DEFAULT_QUIZ_MASTERY_BUCKETS, 'stable']
  }
  return [...DEFAULT_QUIZ_MASTERY_BUCKETS]
}

function asMixRatio(
  value: unknown,
  weights: { mindmap_branch: number; anki_card: number; quiz_question: number },
  options?: { hasExplicitWeights?: boolean },
): FreestyleMixRatio {
  const hasExplicitWeights = Boolean(options?.hasExplicitWeights)
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (raw) {
    return {
      mindmap: asInt(raw.mindmap, DEFAULT_FREESTYLE_FEED_CONFIG.mix_ratio.mindmap, 1, 10),
      quiz: asInt(raw.quiz, DEFAULT_FREESTYLE_FEED_CONFIG.mix_ratio.quiz, 1, 10),
    }
  }
  if (hasExplicitWeights) {
    // Legacy: derive from weights (palace-side = mindmap + anki).
    const mapWeight = Math.max(0, weights.mindmap_branch) + Math.max(0, weights.anki_card)
    const quizWeight = Math.max(0, weights.quiz_question)
    return {
      mindmap: Math.min(10, Math.max(1, mapWeight || 2)),
      quiz: Math.min(10, Math.max(1, quizWeight || 1)),
    }
  }
  return { ...DEFAULT_FREESTYLE_FEED_CONFIG.mix_ratio }
}

/**
 * Infer mix_mode from legacy content/weights when the field is missing.
 * Keeps older USB preferences behaving like the previous weight interleave.
 */
function inferMixMode(
  rawMode: unknown,
  content: { mindmap_branch: boolean; anki_card: boolean; quiz_question: boolean },
): FreestyleMixMode {
  const explicit = asMixMode(rawMode)
  if (explicit) return explicit

  const mapOn = content.mindmap_branch || content.anki_card
  const quizOn = content.quiz_question
  if (mapOn && !quizOn) return 'mindmap_only'
  if (!mapOn && quizOn) return 'quiz_only'
  // Previous default was weighted interleave of map + quiz.
  return 'ratio'
}

export function sanitizeFreestyleFeedConfig(value: unknown): FreestyleFeedConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const contentRaw = raw.content && typeof raw.content === 'object' ? (raw.content as Record<string, unknown>) : {}
  const weightsRaw = raw.weights && typeof raw.weights === 'object' ? (raw.weights as Record<string, unknown>) : {}
  let mindmap = asBoolean(contentRaw.mindmap_branch, true)
  let anki = asBoolean(contentRaw.anki_card, true)
  let quiz = asBoolean(contentRaw.quiz_question, true)
  if (!mindmap && !anki && !quiz) {
    mindmap = true
    anki = true
    quiz = true
  }
  const content = {
    mindmap_branch: mindmap,
    anki_card: anki,
    quiz_question: quiz,
  }
  const weights = {
    mindmap_branch: asInt(weightsRaw.mindmap_branch, 2, 0, 20),
    anki_card: asInt(weightsRaw.anki_card, 2, 0, 20),
    quiz_question: asInt(weightsRaw.quiz_question, 1, 0, 20),
  }
  const mix_mode = inferMixMode(raw.mix_mode, content)
  const mix_ratio = asMixRatio(raw.mix_ratio, weights, { hasExplicitWeights: Boolean(raw.weights) })
  // Legacy weights stay independent; mix_ratio is the interleave source of truth.
  // Zero out disabled content streams so older weight readers stay coherent.
  const syncedWeights = {
    mindmap_branch: mindmap ? weights.mindmap_branch : 0,
    anki_card: anki ? weights.anki_card : 0,
    quiz_question: quiz ? weights.quiz_question : 0,
  }
  const due_policy = asDuePolicy(raw.due_policy)
  const hasExplicitBuckets = Object.prototype.hasOwnProperty.call(raw, 'quiz_mastery_buckets')

  return {
    content,
    weights: syncedWeights,
    mix_mode,
    mix_ratio,
    bound_quiz_placement: asBoundPlacement(raw.bound_quiz_placement),
    palace_order: asPalaceOrder(raw.palace_order),
    due_policy,
    quiz_mastery_buckets: asQuizMasteryBuckets(raw.quiz_mastery_buckets, due_policy, hasExplicitBuckets),
    quiz_scope: asQuizScope(raw.quiz_scope),
    queue_length: asInt(raw.queue_length, 20, 5, 100),
    specific_palace_ids: asIdList(raw.specific_palace_ids),
    question_type: asQuestionType(raw.question_type),
    weak_quiz_priority: asBoolean(raw.weak_quiz_priority, true),
    seed: asInt(raw.seed, 17, 1, 2_147_483_647),
  }
}

export function createOperationId(now = Date.now(), randomPart = Math.random().toString(36).slice(2, 10)) {
  return `freestyle-op-${now}-${randomPart}`
}
