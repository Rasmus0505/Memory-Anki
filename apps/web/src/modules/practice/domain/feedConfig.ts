import type {
  FreestyleDuePolicy,
  FreestyleFeedConfig,
  FreestylePalaceOrder,
  FreestyleQuestionTypeFilter,
  FreestyleWithinPalaceOrder,
} from '@/shared/api/contracts'

export const FREESTYLE_FEED_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.feed-config.v1'

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
  palace_order: 'finish_palace_then_next',
  within_palace_order: 'tree_order',
  // Mind-map cards are formal-due only; expand still fills with quizzes when enabled.
  due_policy: 'due_only',
  node_limit: 12,
  queue_length: 20,
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
  include_calendar_today_due: false,
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

function asWithinOrder(value: unknown): FreestyleWithinPalaceOrder {
  return value === 'deterministic_shuffle' ? 'deterministic_shuffle' : 'tree_order'
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
  return {
    content: {
      mindmap_branch: mindmap,
      anki_card: anki,
      quiz_question: quiz,
    },
    weights: {
      mindmap_branch: asInt(weightsRaw.mindmap_branch, 2, 0, 20),
      anki_card: asInt(weightsRaw.anki_card, 2, 0, 20),
      quiz_question: asInt(weightsRaw.quiz_question, 1, 0, 20),
    },
    palace_order: asPalaceOrder(raw.palace_order),
    within_palace_order: asWithinOrder(raw.within_palace_order),
    due_policy: asDuePolicy(raw.due_policy),
    node_limit: asInt(raw.node_limit, 12, 3, 50),
    queue_length: asInt(raw.queue_length, 20, 5, 100),
    specific_palace_ids: asIdList(raw.specific_palace_ids),
    question_type: asQuestionType(raw.question_type),
    weak_quiz_priority: asBoolean(raw.weak_quiz_priority, true),
    include_calendar_today_due: asBoolean(raw.include_calendar_today_due, false),
    seed: asInt(raw.seed, 17, 1, 2_147_483_647),
  }
}

export function createOperationId(now = Date.now(), randomPart = Math.random().toString(36).slice(2, 10)) {
  return `freestyle-op-${now}-${randomPart}`
}
