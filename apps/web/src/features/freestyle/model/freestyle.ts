import type {
  FreestyleCard,
  FreestyleContentType,
  FreestyleQuestionTypeFilter,
  FreestyleRange,
  FreestyleQuizCard,
} from '@/shared/api/contracts'
import type { QuizRuntimeState } from '@/features/palace-quiz/QuizQuestionInteraction'

export type FreestyleOrderMode = 'palace_complete_then_random' | 'random' | 'sequential'
export type FreestyleActionFrequency = 'none' | 'low' | 'medium' | 'high'

export interface FreestyleConfig {
  range: FreestyleRange
  contentTypes: Record<FreestyleContentType, boolean>
  specificPalaceIds: number[]
  orderMode: FreestyleOrderMode
  questionType: FreestyleQuestionTypeFilter
  actionFrequency: FreestyleActionFrequency
  seed: number
}

export interface FreestyleProgressSnapshot {
  currentIndex: number
  questionStates: Record<number, QuizRuntimeState>
  correctStreak: number
  resolvedQuestionIds: number[]
  lastQueueSignature: string
}

export interface FreestyleQueueOptions {
  resolvedQuestionIds?: number[]
}

export const FREESTYLE_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.config'
export const FREESTYLE_PROGRESS_STORAGE_KEY = 'memory-anki.freestyle.progress'

export const FREESTYLE_CONTENT_TYPES: FreestyleContentType[] = [
  'quiz_question',
  'review',
  'practice',
  'english',
  'english_reading',
]

export const DEFAULT_FREESTYLE_CONFIG: FreestyleConfig = {
  range: 'all',
  contentTypes: {
    quiz_question: true,
    review: true,
    practice: true,
    english: true,
    english_reading: true,
  },
  specificPalaceIds: [],
  orderMode: 'palace_complete_then_random',
  questionType: 'all',
  actionFrequency: 'medium',
  seed: 17,
}

export const DEFAULT_FREESTYLE_PROGRESS: FreestyleProgressSnapshot = {
  currentIndex: 0,
  questionStates: {},
  correctStreak: 0,
  resolvedQuestionIds: [],
  lastQueueSignature: '',
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeNumberList(value: unknown) {
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

function sanitizeSeed(value: unknown) {
  const seed = Number(value)
  if (!Number.isFinite(seed)) return DEFAULT_FREESTYLE_CONFIG.seed
  return Math.max(1, Math.round(seed))
}

export function sanitizeFreestyleConfig(value: unknown): FreestyleConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawContentTypes =
    raw.contentTypes && typeof raw.contentTypes === 'object'
      ? (raw.contentTypes as Record<string, unknown>)
      : {}
  const contentTypes = FREESTYLE_CONTENT_TYPES.reduce(
    (next, key) => ({
      ...next,
      [key]: sanitizeBoolean(rawContentTypes[key], DEFAULT_FREESTYLE_CONFIG.contentTypes[key]),
    }),
    {} as FreestyleConfig['contentTypes'],
  )
  const range =
    raw.range === 'due' ||
    raw.range === 'needs_practice' ||
    raw.range === 'specific_palaces'
      ? raw.range
      : 'all'
  const orderMode =
    raw.orderMode === 'random' || raw.orderMode === 'sequential'
      ? raw.orderMode
      : 'palace_complete_then_random'
  const actionFrequency =
    raw.actionFrequency === 'none' ||
    raw.actionFrequency === 'low' ||
    raw.actionFrequency === 'high'
      ? raw.actionFrequency
      : 'medium'
  const questionType =
    raw.questionType === 'multiple_choice' ||
    raw.questionType === 'true_false' ||
    raw.questionType === 'fill_blank' ||
    raw.questionType === 'matching' ||
    raw.questionType === 'ordering' ||
    raw.questionType === 'categorization' ||
    raw.questionType === 'short_answer'
      ? raw.questionType
      : 'all'
  return {
    range,
    contentTypes,
    specificPalaceIds: sanitizeNumberList(raw.specificPalaceIds),
    orderMode,
    questionType,
    actionFrequency,
    seed: sanitizeSeed(raw.seed),
  }
}

export function readFreestyleConfig(): FreestyleConfig {
  if (typeof window === 'undefined') return DEFAULT_FREESTYLE_CONFIG
  try {
    const raw = window.localStorage.getItem(FREESTYLE_CONFIG_STORAGE_KEY)
    if (!raw) return DEFAULT_FREESTYLE_CONFIG
    return sanitizeFreestyleConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_FREESTYLE_CONFIG
  }
}

export function saveFreestyleConfig(config: FreestyleConfig) {
  const sanitized = sanitizeFreestyleConfig(config)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FREESTYLE_CONFIG_STORAGE_KEY, JSON.stringify(sanitized))
  }
  return sanitized
}

function sanitizeQuestionStates(value: unknown): Record<number, QuizRuntimeState> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<number, QuizRuntimeState> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, state]) => {
    const id = Number(key)
    if (!Number.isInteger(id) || id <= 0 || !state || typeof state !== 'object') return
    result[id] = state as QuizRuntimeState
  })
  return result
}

export function sanitizeFreestyleProgress(value: unknown): FreestyleProgressSnapshot {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const currentIndex = Math.max(0, Math.round(Number(raw.currentIndex) || 0))
  const correctStreak = Math.max(0, Math.round(Number(raw.correctStreak) || 0))
  return {
    currentIndex,
    questionStates: sanitizeQuestionStates(raw.questionStates),
    correctStreak,
    resolvedQuestionIds: sanitizeNumberList(raw.resolvedQuestionIds),
    lastQueueSignature: typeof raw.lastQueueSignature === 'string' ? raw.lastQueueSignature : '',
  }
}

export function readFreestyleProgress(): FreestyleProgressSnapshot {
  if (typeof window === 'undefined') return DEFAULT_FREESTYLE_PROGRESS
  try {
    const raw = window.localStorage.getItem(FREESTYLE_PROGRESS_STORAGE_KEY)
    if (!raw) return DEFAULT_FREESTYLE_PROGRESS
    return sanitizeFreestyleProgress(JSON.parse(raw))
  } catch {
    return DEFAULT_FREESTYLE_PROGRESS
  }
}

export function saveFreestyleProgress(progress: FreestyleProgressSnapshot) {
  const sanitized = sanitizeFreestyleProgress(progress)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FREESTYLE_PROGRESS_STORAGE_KEY, JSON.stringify(sanitized))
  }
  return sanitized
}

function seededRandom(seed: number) {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

function shuffleStable<T>(items: T[], seed: number) {
  const next = [...items]
  const random = seededRandom(seed)
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const value = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = value
  }
  return next
}

function isQuizCard(card: FreestyleCard): card is FreestyleQuizCard {
  return card.type === 'quiz_question'
}

function actionInterval(frequency: FreestyleActionFrequency) {
  if (frequency === 'none') return 0
  if (frequency === 'high') return 3
  if (frequency === 'low') return 9
  return 6
}

export function enabledContentTypes(config: FreestyleConfig): FreestyleContentType[] {
  return FREESTYLE_CONTENT_TYPES.filter((type) => config.contentTypes[type])
}

function downgradeResolvedQuizCards<T extends FreestyleCard>(
  cards: T[],
  resolvedQuestionIds: Set<number>,
) {
  if (resolvedQuestionIds.size === 0) return cards
  const fresh: T[] = []
  const resolved: T[] = []
  cards.forEach((card) => {
    if (isQuizCard(card) && resolvedQuestionIds.has(card.question.id)) {
      resolved.push(card)
    } else {
      fresh.push(card)
    }
  })
  return [...fresh, ...resolved]
}

export function buildFreestyleQueue(
  cards: FreestyleCard[],
  config: FreestyleConfig,
  options: FreestyleQueueOptions = {},
) {
  const resolvedQuestionIds = new Set(options.resolvedQuestionIds ?? [])
  const enabled = new Set(enabledContentTypes(config))
  const filtered = cards.filter((card) => {
    if (!enabled.has(card.content_type)) return false
    if (isQuizCard(card) && config.questionType !== 'all') {
      return card.question.question_type === config.questionType
    }
    if (
      config.range === 'specific_palaces' &&
      config.specificPalaceIds.length > 0 &&
      card.palace_context?.id
    ) {
      return config.specificPalaceIds.includes(card.palace_context.id)
    }
    return true
  })

  const quizCards = filtered.filter(isQuizCard)
  const actionCards = filtered
    .filter((card): card is Exclude<FreestyleCard, FreestyleQuizCard> => !isQuizCard(card))
    .sort((a, b) => b.priority - a.priority)

  if (config.orderMode === 'random') {
    return downgradeResolvedQuizCards(shuffleStable(filtered, config.seed), resolvedQuestionIds)
  }

  const orderedQuizCards =
    config.orderMode === 'sequential'
      ? quizCards
      : shuffleStable(
          Array.from(
            quizCards.reduce((groups, card) => {
              const group = groups.get(card.group_key) ?? []
              group.push(card)
              groups.set(card.group_key, group)
              return groups
            }, new Map<string, FreestyleQuizCard[]>()).values(),
          ),
          config.seed,
        ).flat()

  const prioritizedQuizCards = downgradeResolvedQuizCards(orderedQuizCards, resolvedQuestionIds)
  const interval = actionInterval(config.actionFrequency)
  if (interval <= 0) {
    return prioritizedQuizCards.length > 0 ? prioritizedQuizCards : actionCards
  }
  if (prioritizedQuizCards.length === 0) {
    return actionCards
  }

  const queue: FreestyleCard[] = []
  let actionIndex = 0
  prioritizedQuizCards.forEach((card, index) => {
    queue.push(card)
    if ((index + 1) % interval !== 0) return
    if (actionIndex >= actionCards.length) return
    queue.push(actionCards[actionIndex])
    actionIndex += 1
  })
  return [...queue, ...actionCards.slice(actionIndex)]
}

export function buildQueueSignature(cards: FreestyleCard[]) {
  return cards.map((card) => card.id).join('|')
}

export function nextFreestyleSeed(seed: number) {
  return sanitizeSeed(seed + 1 + Math.floor(Math.random() * 10000))
}
