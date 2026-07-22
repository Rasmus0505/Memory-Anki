import type {
  FreestyleActionCard,
  FreestyleCard,
  FreestyleContentType,
  FreestyleQuizCard,
} from '@/shared/api/contracts'
import {
  DEFAULT_FREESTYLE_PROGRESS,
  sanitizeFreestyleProgress,
  type FreestyleProgressSnapshot,
} from './freestyle'

export type FreestyleMode = 'today' | 'free'

export interface TodayTrainingConfig {
  roundSize: number
  includeEnglish: boolean
  includeEnglishReading: boolean
  seed: number
}

export interface TodayTrainingQueueSources {
  dueCards: FreestyleCard[]
  practiceCards: FreestyleCard[]
  fillCards: FreestyleCard[]
}

export interface TodayTrainingSummary {
  totalCount: number
  answeredCount: number
  correctCount: number
  incorrectCount: number
  dueActionCount: number
  durationSeconds: number
  suggestion: string
}

export const TODAY_TRAINING_CONFIG_STORAGE_KEY = 'memory-anki.freestyle.today.config'
export const TODAY_TRAINING_PROGRESS_STORAGE_KEY = 'memory-anki.freestyle.today.progress'
export const TODAY_TRAINING_ROUND_SIZE = 12

export const DEFAULT_TODAY_TRAINING_CONFIG: TodayTrainingConfig = {
  roundSize: TODAY_TRAINING_ROUND_SIZE,
  includeEnglish: false,
  includeEnglishReading: false,
  seed: 23,
}

export const EMPTY_TODAY_TRAINING_SOURCES: TodayTrainingQueueSources = {
  dueCards: [],
  practiceCards: [],
  fillCards: [],
}

export type TodayTrainingProgressSnapshot = FreestyleProgressSnapshot

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeSeed(value: unknown) {
  const seed = Number(value)
  if (!Number.isFinite(seed)) return DEFAULT_TODAY_TRAINING_CONFIG.seed
  return Math.max(1, Math.round(seed))
}

export function sanitizeTodayTrainingConfig(value: unknown): TodayTrainingConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    roundSize: TODAY_TRAINING_ROUND_SIZE,
    includeEnglish: sanitizeBoolean(
      raw.includeEnglish,
      DEFAULT_TODAY_TRAINING_CONFIG.includeEnglish,
    ),
    includeEnglishReading: sanitizeBoolean(
      raw.includeEnglishReading,
      DEFAULT_TODAY_TRAINING_CONFIG.includeEnglishReading,
    ),
    seed: sanitizeSeed(raw.seed),
  }
}

export function readTodayTrainingConfig(): TodayTrainingConfig {
  if (typeof window === 'undefined') return DEFAULT_TODAY_TRAINING_CONFIG
  try {
    const raw = window.localStorage.getItem(TODAY_TRAINING_CONFIG_STORAGE_KEY)
    if (!raw) return DEFAULT_TODAY_TRAINING_CONFIG
    return sanitizeTodayTrainingConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_TODAY_TRAINING_CONFIG
  }
}

export function saveTodayTrainingConfig(config: TodayTrainingConfig) {
  const sanitized = sanitizeTodayTrainingConfig(config)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TODAY_TRAINING_CONFIG_STORAGE_KEY, JSON.stringify(sanitized))
  }
  return sanitized
}

export function readTodayTrainingProgress(): TodayTrainingProgressSnapshot {
  if (typeof window === 'undefined') return DEFAULT_FREESTYLE_PROGRESS
  try {
    const raw = window.localStorage.getItem(TODAY_TRAINING_PROGRESS_STORAGE_KEY)
    if (!raw) return DEFAULT_FREESTYLE_PROGRESS
    return sanitizeFreestyleProgress(JSON.parse(raw))
  } catch {
    return DEFAULT_FREESTYLE_PROGRESS
  }
}

export function saveTodayTrainingProgress(progress: TodayTrainingProgressSnapshot) {
  const sanitized = sanitizeFreestyleProgress(progress)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(TODAY_TRAINING_PROGRESS_STORAGE_KEY, JSON.stringify(sanitized))
  }
  return sanitized
}

function isQuizCard(card: FreestyleCard): card is FreestyleQuizCard {
  return card.type === 'quiz_question'
}

function isActionCard(card: FreestyleCard): card is FreestyleActionCard {
  return card.type === 'action'
}

function isDueActionCard(card: FreestyleCard): card is FreestyleActionCard {
  return (
    isActionCard(card) &&
    card.content_type === 'review'
  )
}

function isPracticeActionCard(card: FreestyleCard): card is FreestyleActionCard {
  return isActionCard(card) && card.content_type === 'practice'
}

function isEnabledFillActionCard(
  card: FreestyleCard,
  config: TodayTrainingConfig,
): card is FreestyleActionCard {
  if (!isActionCard(card)) return false
  if (card.content_type === 'english') return config.includeEnglish
  if (card.content_type === 'english_reading') return config.includeEnglishReading
  return false
}

function sortActionsByPriority(cards: FreestyleActionCard[]) {
  return [...cards].sort((left, right) => right.priority - left.priority)
}

function orderQuizCards(
  cards: FreestyleQuizCard[],
  resolvedQuestionIds: Set<number>,
) {
  const fresh: FreestyleQuizCard[] = []
  const resolved: FreestyleQuizCard[] = []
  cards.forEach((card) => {
    if (resolvedQuestionIds.has(card.question.id)) {
      resolved.push(card)
    } else {
      fresh.push(card)
    }
  })
  return [...fresh, ...resolved]
}

function appendUnique(
  target: FreestyleCard[],
  cards: FreestyleCard[],
  seenCardIds: Set<string>,
) {
  cards.forEach((card) => {
    if (seenCardIds.has(card.id)) return
    seenCardIds.add(card.id)
    target.push(card)
  })
}

export function buildTodayTrainingQueue(
  sources: TodayTrainingQueueSources,
  config: TodayTrainingConfig,
  options: { resolvedQuestionIds?: number[] } = {},
) {
  const resolvedQuestionIds = new Set(options.resolvedQuestionIds ?? [])
  const seenCardIds = new Set<string>()
  const queue: FreestyleCard[] = []

  appendUnique(
    queue,
    sortActionsByPriority(sources.dueCards.filter(isDueActionCard)),
    seenCardIds,
  )
  appendUnique(
    queue,
    orderQuizCards(
      sources.dueCards.filter(isQuizCard),
      resolvedQuestionIds,
    ),
    seenCardIds,
  )
  appendUnique(
    queue,
    sortActionsByPriority(sources.practiceCards.filter(isPracticeActionCard)),
    seenCardIds,
  )
  appendUnique(
    queue,
    orderQuizCards(
      sources.practiceCards.filter(isQuizCard),
      resolvedQuestionIds,
    ),
    seenCardIds,
  )
  appendUnique(
    queue,
    orderQuizCards(
      sources.fillCards.filter(isQuizCard),
      resolvedQuestionIds,
    ),
    seenCardIds,
  )
  appendUnique(
    queue,
    sortActionsByPriority(sources.fillCards.filter((card) => isEnabledFillActionCard(card, config))),
    seenCardIds,
  )

  return queue.slice(0, config.roundSize)
}

export function restoreTodayTrainingQueue(
  sources: TodayTrainingQueueSources,
  activeQueueIds: string[],
) {
  if (activeQueueIds.length === 0) return []
  const cardsById = new Map<string, FreestyleCard>()
  const sourceCards = [
    ...sources.dueCards,
    ...sources.practiceCards,
    ...sources.fillCards,
  ]
  sourceCards.forEach((card) => {
    if (cardsById.has(card.id)) return
    cardsById.set(card.id, card)
  })

  const restored: FreestyleCard[] = []
  const seenCardIds = new Set<string>()
  activeQueueIds.forEach((id) => {
    if (seenCardIds.has(id)) return
    const card = cardsById.get(id)
    if (!card) return
    seenCardIds.add(id)
    restored.push(card)
  })
  return restored
}

export function buildTodayTrainingSummary(
  queue: FreestyleCard[],
  progress: FreestyleProgressSnapshot,
  durationSeconds: number,
): TodayTrainingSummary {
  let answeredCount = 0
  let correctCount = 0
  let incorrectCount = 0
  let dueActionCount = 0

  queue.forEach((card) => {
    if (isDueActionCard(card)) {
      dueActionCount += 1
      return
    }
    if (!isQuizCard(card)) return
    const state = progress.questionStates[card.question.id]
    if (!state?.resolved) return
    answeredCount += 1
    if (state.correct === true) correctCount += 1
    if (state.correct === false) incorrectCount += 1
  })

  let suggestion = '状态不错，可以再来一轮。'
  if (incorrectCount > 0) {
    suggestion = '先把答错题再过一遍，再来一轮会更稳。'
  } else if (dueActionCount > 0) {
    suggestion = '先把到期复习推进掉，今天的节奏会轻很多。'
  } else if (answeredCount === 0) {
    suggestion = '先完成几张题卡，让系统拿到一点反馈。'
  }

  return {
    totalCount: queue.length,
    answeredCount,
    correctCount,
    incorrectCount,
    dueActionCount,
    durationSeconds,
    suggestion,
  }
}

export function nextTodayTrainingSeed(seed: number) {
  return sanitizeSeed(seed + 1 + Math.floor(Math.random() * 10000))
}

export function todayFeedContentTypes(config: TodayTrainingConfig): {
  due: FreestyleContentType[]
  practice: FreestyleContentType[]
  fill: FreestyleContentType[]
} {
  return {
    due: ['quiz_question', 'review'],
    practice: ['quiz_question', 'practice'],
    fill: [
      'quiz_question',
      ...(config.includeEnglish ? (['english'] as const) : []),
      ...(config.includeEnglishReading ? (['english_reading'] as const) : []),
    ],
  }
}
