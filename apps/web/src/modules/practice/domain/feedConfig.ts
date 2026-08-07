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
  FreestyleSubjectScope,
  FreestyleTrainingMode,
  FreestyleTrainingMix,
  FreestyleTrainingStream,
  FreestyleTrainingStreams,
  FreestyleUnitOrder,
} from '@/shared/api/contracts'
import type { FreestylePalaceContext } from '@/shared/api/contracts'

export const FREESTYLE_FEED_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.feed-config.v2'
export const LEGACY_FREESTYLE_FEED_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.feed-config.v1'

export const FREESTYLE_TRAINING_MODES: FreestyleTrainingMode[] = [
  'memory_palace',
  'quiz',
  'english',
  'mixed',
]

export const FREESTYLE_TRAINING_STREAMS: FreestyleTrainingStream[] = [
  'memory_palace',
  'quiz',
  'english',
]

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

export type FreestyleQuickPresetId = 'quiz' | 'english' | 'memory_palace'

export interface FreestyleQuickPreset {
  id: FreestyleQuickPresetId
  label: string
  description: string
}

export const FREESTYLE_QUICK_PRESETS: FreestyleQuickPreset[] = [
  { id: 'quiz', label: '刷题', description: '只进入练习题' },
  { id: 'english', label: '英语', description: '只进入英语学科宫殿' },
  { id: 'memory_palace', label: '记忆宫殿', description: '排除英语学科，只刷宫殿卡' },
]

export const DEFAULT_FREESTYLE_FEED_CONFIG: FreestyleFeedConfig = {
  training_mode: 'mixed',
  mixed_modes: ['memory_palace', 'quiz'],
  streams: {
    memory_palace: {
      specific_palace_ids: [],
      subject_scope: 'non_english',
      due_policy: 'due_first_then_expand',
      palace_order: 'finish_palace_then_next',
      unit_order: 'structured',
    },
    quiz: {
      specific_palace_ids: [],
      subject_scope: 'all',
      question_type: 'all',
      mastery_buckets: [...DEFAULT_QUIZ_MASTERY_BUCKETS],
      quiz_scope: 'cross_palace_random',
      weak_priority: true,
    },
    english: {
      specific_palace_ids: [],
      subject_scope: 'english',
      due_policy: 'due_first_then_expand',
      palace_order: 'finish_palace_then_next',
      unit_order: 'structured',
    },
  },
  mix: {
    strategy: 'ratio',
    ratios: { memory_palace: 2, quiz: 1, english: 1 },
  },
  queue_length: 20,
  seed: 17,
  content: {
    mindmap_branch: true,
    anki_card: false,
    quiz_question: true,
  },
  weights: {
    mindmap_branch: 2,
    anki_card: 0,
    quiz_question: 1,
  },
  mix_mode: 'ratio',
  mix_ratio: {
    mindmap: 2,
    quiz: 1,
  },
  // Legacy projection only. New queue code reads `mix` and stream config.
  bound_quiz_placement: 'into_mix',
  palace_order: 'finish_palace_then_next',
  // Legacy projection only; new palace streams default to due-first expansion.
  due_policy: 'due_first_then_expand',
  quiz_mastery_buckets: [...DEFAULT_QUIZ_MASTERY_BUCKETS],
  quiz_scope: 'cross_palace_random',
  specific_palace_ids: [],
  subject_scope: 'all',
  question_type: 'all',
  weak_quiz_priority: true,
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

function asDuePolicy(value: unknown, fallback: FreestyleDuePolicy = 'due_first_then_expand'): FreestyleDuePolicy {
  if (value === 'due_first_then_expand' || value === 'due_only' || value === 'all_content_due_weighted') return value
  return fallback
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

function asSubjectScope(value: unknown): FreestyleSubjectScope {
  return value === 'english' || value === 'non_english' ? value : 'all'
}

function asTrainingMode(value: unknown): FreestyleTrainingMode | null {
  return FREESTYLE_TRAINING_MODES.includes(value as FreestyleTrainingMode)
    ? value as FreestyleTrainingMode
    : null
}

function asUnitOrder(value: unknown): FreestyleUnitOrder {
  return value === 'random' ? 'random' : 'structured'
}

function asMixStrategy(value: unknown): FreestyleTrainingMix['strategy'] {
  return value === 'random' || value === 'sequential' ? value : 'ratio'
}

function streamScope(
  value: unknown,
  fallback: { specific_palace_ids: number[]; subject_scope: FreestyleSubjectScope },
): { specific_palace_ids: number[]; subject_scope: FreestyleSubjectScope } {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    specific_palace_ids: asIdList(raw.specific_palace_ids ?? fallback.specific_palace_ids),
    subject_scope: asSubjectScope(raw.subject_scope ?? fallback.subject_scope),
  }
}

function inferTrainingMode(
  rawMode: unknown,
  rawMixMode: unknown,
  content: { mindmap_branch: boolean; quiz_question: boolean },
  subjectScope: FreestyleSubjectScope,
): FreestyleTrainingMode {
  const explicit = asTrainingMode(rawMode)
  if (explicit) return explicit
  const legacyMixMode = asMixMode(rawMixMode)
  if (legacyMixMode === 'quiz_only') return 'quiz'
  if (legacyMixMode === 'mindmap_only') {
    return subjectScope === 'english' ? 'english' : 'memory_palace'
  }
  if (content.mindmap_branch && !content.quiz_question) {
    return subjectScope === 'english' ? 'english' : 'memory_palace'
  }
  if (!content.mindmap_branch && content.quiz_question) return 'quiz'
  return 'mixed'
}

function sanitizeMixedModes(value: unknown, fallback: FreestyleTrainingStream[]): FreestyleTrainingStream[] {
  const raw = Array.isArray(value) ? value : []
  const next = [...new Set(raw.filter((item): item is FreestyleTrainingStream =>
    FREESTYLE_TRAINING_STREAMS.includes(item as FreestyleTrainingStream),
  ))]
  if (next.length > 0) return next
  return [...fallback]
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
  const legacySubjectScope = asSubjectScope(raw.subject_scope)
  const legacyMindmap = asBoolean(contentRaw.mindmap_branch, true)
  const legacyQuiz = asBoolean(contentRaw.quiz_question, true)
  const legacyMode = inferTrainingMode(raw.training_mode, raw.mix_mode, {
    mindmap_branch: legacyMindmap,
    quiz_question: legacyQuiz,
  }, legacySubjectScope)
  const weights = {
    mindmap_branch: asInt(weightsRaw.mindmap_branch, 2, 0, 20),
    anki_card: 0,
    quiz_question: asInt(weightsRaw.quiz_question, 1, 0, 20),
  }
  const legacyMixMode = inferMixMode(raw.mix_mode, {
    mindmap_branch: legacyMindmap,
    anki_card: false,
    quiz_question: legacyQuiz,
  })
  const legacyMixRatio = asMixRatio(raw.mix_ratio, weights, {
    hasExplicitWeights: Object.prototype.hasOwnProperty.call(raw, 'weights'),
  })
  const legacyIds = asIdList(raw.specific_palace_ids)
  const legacyDuePolicy = asDuePolicy(raw.due_policy, 'due_first_then_expand')
  const legacyPalaceOrder = asPalaceOrder(raw.palace_order)
  const rawStreams = raw.streams && typeof raw.streams === 'object'
    ? raw.streams as Record<string, unknown>
    : {}
  const hasExplicitNewConfig = Object.prototype.hasOwnProperty.call(raw, 'training_mode')
    || Object.prototype.hasOwnProperty.call(raw, 'streams')
    || Object.keys(raw).length === 0
  const rawMemory = rawStreams.memory_palace && typeof rawStreams.memory_palace === 'object'
    ? rawStreams.memory_palace as Record<string, unknown>
    : {}
  const rawQuiz = rawStreams.quiz && typeof rawStreams.quiz === 'object'
    ? rawStreams.quiz as Record<string, unknown>
    : {}
  const rawEnglish = rawStreams.english && typeof rawStreams.english === 'object'
    ? rawStreams.english as Record<string, unknown>
    : {}

  const memoryScope = streamScope(rawMemory, {
    specific_palace_ids: legacySubjectScope === 'english' ? [] : legacyIds,
    subject_scope: legacySubjectScope === 'english' ? 'non_english' : 'non_english',
  })
  const quizScope = streamScope(rawQuiz, {
    specific_palace_ids: legacyIds,
    subject_scope: legacySubjectScope,
  })
  const englishScope = streamScope(rawEnglish, {
    specific_palace_ids: legacySubjectScope === 'english' ? legacyIds : [],
    subject_scope: 'english',
  })
  englishScope.subject_scope = 'english'

  const memoryStream = {
    ...memoryScope,
    due_policy: asDuePolicy(rawMemory.due_policy, legacyDuePolicy),
    palace_order: asPalaceOrder(rawMemory.palace_order ?? legacyPalaceOrder),
    unit_order: asUnitOrder(rawMemory.unit_order),
  }
  const englishStream = {
    ...englishScope,
    due_policy: asDuePolicy(rawEnglish.due_policy, legacyDuePolicy),
    palace_order: asPalaceOrder(rawEnglish.palace_order ?? legacyPalaceOrder),
    unit_order: asUnitOrder(rawEnglish.unit_order),
  }
  const quizStream = {
    ...quizScope,
    question_type: asQuestionType(rawQuiz.question_type ?? raw.question_type),
    mastery_buckets: asQuizMasteryBuckets(
      rawQuiz.mastery_buckets ?? raw.quiz_mastery_buckets,
      memoryStream.due_policy,
      hasExplicitNewConfig
        || !Object.prototype.hasOwnProperty.call(raw, 'due_policy')
        || Object.prototype.hasOwnProperty.call(rawQuiz, 'mastery_buckets')
        || Object.prototype.hasOwnProperty.call(raw, 'quiz_mastery_buckets'),
    ),
    quiz_scope: asQuizScope(rawQuiz.quiz_scope ?? raw.quiz_scope),
    weak_priority: asBoolean(rawQuiz.weak_priority ?? raw.weak_quiz_priority, true),
  }

  const hasExplicitNewMode = Object.prototype.hasOwnProperty.call(raw, 'training_mode')
  let trainingMode = hasExplicitNewMode ? (asTrainingMode(raw.training_mode) ?? legacyMode) : legacyMode
  const modeFallback: FreestyleTrainingStream[] = legacyMode === 'mixed'
    ? [legacyMindmap ? 'memory_palace' : 'quiz', ...(legacyMindmap && legacyQuiz ? ['quiz' as const] : [])]
    : [legacyMode === 'english' ? 'english' : legacyMode === 'quiz' ? 'quiz' : 'memory_palace']
  let mixedModes = sanitizeMixedModes(raw.mixed_modes, modeFallback.length >= 2 ? modeFallback : ['memory_palace', 'quiz'])
  if (trainingMode !== 'mixed') mixedModes = [trainingMode]
  if (trainingMode === 'mixed' && mixedModes.length < 2) {
    trainingMode = mixedModes[0] ?? 'memory_palace'
    mixedModes = [trainingMode]
  }

  const rawMix = raw.mix && typeof raw.mix === 'object' ? raw.mix as Record<string, unknown> : {}
  const rawRatios = rawMix.ratios && typeof rawMix.ratios === 'object' ? rawMix.ratios as Record<string, unknown> : {}
  const legacyStrategy = legacyMixMode === 'random'
    ? 'random'
    : legacyMixMode === 'sequential_map_quiz' || legacyMixMode === 'sequential_quiz_map'
      ? 'sequential'
      : 'ratio'
  const mix: FreestyleTrainingMix = {
    strategy: asMixStrategy(rawMix.strategy ?? legacyStrategy),
    ratios: {
      memory_palace: asInt(rawRatios.memory_palace, legacyMixRatio.mindmap, 1, 10),
      quiz: asInt(rawRatios.quiz, legacyMixRatio.quiz, 1, 10),
      english: asInt(rawRatios.english, 1, 1, 10),
    },
  }

  const mapStreams = mixedModes.filter((item) => item === 'memory_palace' || item === 'english')
  const hasMemory = trainingMode === 'memory_palace' || (trainingMode === 'mixed' && mixedModes.includes('memory_palace'))
  const hasEnglish = trainingMode === 'english' || (trainingMode === 'mixed' && mixedModes.includes('english'))
  const hasQuiz = trainingMode === 'quiz' || (trainingMode === 'mixed' && mixedModes.includes('quiz'))
  const mapRatio = mapStreams.reduce((sum, item) => sum + mix.ratios[item], 0)
  const quizRatio = hasQuiz ? mix.ratios.quiz : 0
  const firstMap = mixedModes.find((item) => item === 'memory_palace' || item === 'english')
  const mixMode: FreestyleMixMode = trainingMode === 'quiz'
    ? 'quiz_only'
    : trainingMode === 'memory_palace' || trainingMode === 'english' || !hasQuiz
      ? 'mindmap_only'
      : mix.strategy === 'random'
        ? 'random'
        : mix.strategy === 'sequential'
          ? (firstMap ? 'sequential_map_quiz' : 'sequential_quiz_map')
          : 'ratio'
  const legacySpecificIds = [...new Set([
    ...(hasMemory ? memoryStream.specific_palace_ids : []),
    ...(hasEnglish ? englishStream.specific_palace_ids : []),
    ...(hasQuiz ? quizStream.specific_palace_ids : []),
  ])]
  const legacyScope = trainingMode === 'english'
    ? 'english'
    : trainingMode === 'memory_palace'
      ? memoryStream.subject_scope
      : trainingMode === 'quiz'
        ? quizStream.subject_scope
        : 'all'
  const legacyDue = hasMemory ? memoryStream.due_policy : englishStream.due_policy
  const legacyPalace = hasMemory ? memoryStream.palace_order : englishStream.palace_order
  const legacyQuestionType = quizStream.question_type
  const mixRatio: FreestyleMixRatio = {
    mindmap: Math.max(1, mapRatio || 2),
    quiz: Math.max(1, quizRatio || 1),
  }

  return {
    training_mode: trainingMode,
    mixed_modes: mixedModes,
    streams: {
      memory_palace: memoryStream,
      quiz: quizStream,
      english: englishStream,
    } as FreestyleTrainingStreams,
    mix,
    queue_length: asInt(raw.queue_length, 20, 5, 100),
    seed: asInt(raw.seed, 17, 1, 2_147_483_647),
    content: {
      mindmap_branch: hasMemory || hasEnglish,
      anki_card: false,
      quiz_question: hasQuiz,
    },
    weights: {
      mindmap_branch: hasMemory || hasEnglish ? Math.max(1, mapRatio || 2) : 0,
      anki_card: 0,
      quiz_question: hasQuiz ? Math.max(1, quizRatio || 1) : 0,
    },
    mix_mode: mixMode,
    mix_ratio: mixRatio,
    bound_quiz_placement: asBoundPlacement(raw.bound_quiz_placement),
    palace_order: legacyPalace,
    due_policy: legacyDue,
    quiz_mastery_buckets: quizStream.mastery_buckets,
    quiz_scope: quizStream.quiz_scope,
    specific_palace_ids: legacySpecificIds,
    subject_scope: legacyScope,
    question_type: legacyQuestionType,
    weak_quiz_priority: quizStream.weak_priority,
  }
}

/** A palace-scope change starts a new local freestyle round. */
export function freestylePalaceScopeSignature(config: FreestyleFeedConfig): string {
  return JSON.stringify({
    memory_palace: {
      specific_palace_ids: [...config.streams.memory_palace.specific_palace_ids].sort((left, right) => left - right),
      subject_scope: config.streams.memory_palace.subject_scope,
    },
    quiz: {
      specific_palace_ids: [...config.streams.quiz.specific_palace_ids].sort((left, right) => left - right),
      subject_scope: config.streams.quiz.subject_scope,
    },
    english: {
      specific_palace_ids: [...config.streams.english.specific_palace_ids].sort((left, right) => left - right),
      subject_scope: config.streams.english.subject_scope,
    },
  })
}

export function applyFreestyleQuickPreset(
  config: FreestyleFeedConfig,
  presetId: FreestyleQuickPresetId,
  palaces: FreestylePalaceContext[],
) {
  const englishPalaceIds = palaces
    .filter((palace) => palace.subject?.name.trim() === '英语')
    .map((palace) => palace.id)
  const nonEnglishPalaceIds = palaces
    .filter((palace) => palace.subject?.name.trim() !== '英语')
    .map((palace) => palace.id)

  if (presetId === 'quiz') {
    return sanitizeFreestyleFeedConfig({
      ...config,
      training_mode: 'quiz',
      mixed_modes: ['quiz'],
      streams: {
        ...config.streams,
        quiz: {
          ...config.streams.quiz,
          specific_palace_ids: [],
          subject_scope: 'all',
        },
      },
    })
  }

  if (presetId === 'english') {
    return sanitizeFreestyleFeedConfig({
      ...config,
      training_mode: 'english',
      mixed_modes: ['english'],
      streams: {
        ...config.streams,
        english: {
          ...config.streams.english,
          specific_palace_ids: englishPalaceIds,
          subject_scope: 'english',
        },
      },
    })
  }

  return sanitizeFreestyleFeedConfig({
    ...config,
    training_mode: 'memory_palace',
    mixed_modes: ['memory_palace'],
    streams: {
      ...config.streams,
      memory_palace: {
        ...config.streams.memory_palace,
        specific_palace_ids: nonEnglishPalaceIds,
        subject_scope: 'non_english',
      },
    },
  })
}

export function createOperationId(now = Date.now(), randomPart = Math.random().toString(36).slice(2, 10)) {
  return `freestyle-op-${now}-${randomPart}`
}
