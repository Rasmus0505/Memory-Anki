import type { FreestyleCard } from '@/shared/api/contracts'

export type FreestyleSkipState = {
  roundId: string
  startedAt: number
  seed: number
  skipCountById: Record<string, number>
  hiddenIds: string[]
  completedIds: string[]
  mutedPalaceIds: number[]
  lastSkippedId: string | null
  lastSkippedAt: number | null
}

export const DEFAULT_QUEUE_STATE: FreestyleSkipState = {
  roundId: 'freestyle-round-default',
  startedAt: 0,
  seed: 17,
  skipCountById: {},
  hiddenIds: [],
  completedIds: [],
  mutedPalaceIds: [],
  lastSkippedId: null,
  lastSkippedAt: null,
}

export const FREESTYLE_QUEUE_STATE_STORAGE_KEY = 'memory-anki.freestyle.queue-state.v1'
export const UNDO_SKIP_WINDOW_MS = 8_000

export function createQueueRoundState(seed = 17, now = Date.now()): FreestyleSkipState {
  return {
    ...DEFAULT_QUEUE_STATE,
    roundId: `freestyle-round-${now}`,
    startedAt: now,
    seed,
  }
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  value.forEach((item) => {
    const id = typeof item === 'string' ? item.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    result.push(id)
  })
  return result
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

export function sanitizeQueueState(value: unknown): FreestyleSkipState {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const skipRaw =
    raw.skipCountById && typeof raw.skipCountById === 'object'
      ? (raw.skipCountById as Record<string, unknown>)
      : {}
  const skipCountById: Record<string, number> = {}
  Object.entries(skipRaw).forEach(([key, count]) => {
    const n = Math.max(0, Math.round(Number(count) || 0))
    if (key && n > 0) skipCountById[key] = n
  })
  return {
    roundId:
      typeof raw.roundId === 'string' && raw.roundId.trim()
        ? raw.roundId.trim()
        : `freestyle-round-${Date.now()}`,
    startedAt:
      typeof raw.startedAt === 'number' && Number.isFinite(raw.startedAt)
        ? raw.startedAt
        : Date.now(),
    seed: Math.max(1, Math.round(Number(raw.seed) || 17)),
    skipCountById,
    hiddenIds: asStringList(raw.hiddenIds),
    completedIds: asStringList(raw.completedIds),
    mutedPalaceIds: asIdList(raw.mutedPalaceIds),
    lastSkippedId: typeof raw.lastSkippedId === 'string' ? raw.lastSkippedId : null,
    lastSkippedAt:
      typeof raw.lastSkippedAt === 'number' && Number.isFinite(raw.lastSkippedAt)
        ? raw.lastSkippedAt
        : null,
  }
}

export function cardPalaceId(card: FreestyleCard | null | undefined): number | null {
  if (!card) return null
  if (card.type === 'mindmap_branch') return card.palace_id
  if (card.type === 'quiz_question') return card.palace_context?.id ?? null
  return card.palace_context?.id ?? null
}

export function applySkip(
  state: FreestyleSkipState,
  cardId: string,
  now = Date.now(),
): { state: FreestyleSkipState; action: 'to_tail' | 'hide' } {
  const nextCount = (state.skipCountById[cardId] || 0) + 1
  const skipCountById = { ...state.skipCountById, [cardId]: nextCount }
  if (nextCount >= 2) {
    const hiddenIds = state.hiddenIds.includes(cardId)
      ? state.hiddenIds
      : [...state.hiddenIds, cardId]
    return {
      action: 'hide',
      state: {
        ...state,
        skipCountById,
        hiddenIds,
        lastSkippedId: cardId,
        lastSkippedAt: now,
      },
    }
  }
  return {
    action: 'to_tail',
    state: {
      ...state,
      skipCountById,
      lastSkippedId: cardId,
      lastSkippedAt: now,
    },
  }
}

export function undoSkip(state: FreestyleSkipState, now = Date.now()): FreestyleSkipState {
  if (!state.lastSkippedId || !state.lastSkippedAt) return state
  if (now - state.lastSkippedAt > UNDO_SKIP_WINDOW_MS) return state
  const cardId = state.lastSkippedId
  const skipCountById = { ...state.skipCountById }
  const current = skipCountById[cardId] || 0
  if (current <= 1) delete skipCountById[cardId]
  else skipCountById[cardId] = current - 1
  return {
    ...state,
    skipCountById,
    hiddenIds: state.hiddenIds.filter((id) => id !== cardId),
    lastSkippedId: null,
    lastSkippedAt: null,
  }
}

export function markCompleted(state: FreestyleSkipState, cardId: string): FreestyleSkipState {
  if (state.completedIds.includes(cardId)) return state
  return {
    ...state,
    completedIds: [...state.completedIds, cardId],
  }
}

export function mutePalace(state: FreestyleSkipState, palaceId: number): FreestyleSkipState {
  if (state.mutedPalaceIds.includes(palaceId)) return state
  return {
    ...state,
    mutedPalaceIds: [...state.mutedPalaceIds, palaceId],
  }
}

export function moveCardToTail(cards: FreestyleCard[], cardId: string): FreestyleCard[] {
  const index = cards.findIndex((card) => card.id === cardId)
  if (index < 0) return cards
  const next = cards.slice()
  const [card] = next.splice(index, 1)
  next.push(card)
  return next
}

export function filterMutedPalaces(cards: FreestyleCard[], mutedPalaceIds: number[]): FreestyleCard[] {
  if (!mutedPalaceIds.length) return cards
  const muted = new Set(mutedPalaceIds)
  return cards.filter((card) => {
    const palaceId = cardPalaceId(card)
    return palaceId == null || !muted.has(palaceId)
  })
}

/**
 * Index of the first card after ``currentIndex`` that belongs to a different palace.
 * Returns ``null`` when there is no later palace (end of queue / single-palace tail).
 */
export function findNextPalaceIndex(
  cards: FreestyleCard[],
  currentIndex: number,
): number | null {
  if (!cards.length) return null
  const clamped = Math.max(0, Math.min(currentIndex, cards.length - 1))
  const currentPalace = cardPalaceId(cards[clamped])
  for (let index = clamped + 1; index < cards.length; index += 1) {
    const palaceId = cardPalaceId(cards[index])
    if (currentPalace == null) {
      // Unknown palace: treat the immediate next card as "next palace".
      return index
    }
    if (palaceId !== currentPalace) return index
  }
  return null
}

/**
 * Drop the current card and every later card from the same palace so the queue
 * lands on the next palace (or becomes empty if none remain).
 */
export function skipRemainingPalaceCards(
  cards: FreestyleCard[],
  currentIndex: number,
): { cards: FreestyleCard[]; nextIndex: number } {
  if (!cards.length) return { cards: [], nextIndex: 0 }
  const clamped = Math.max(0, Math.min(currentIndex, cards.length - 1))
  const currentPalace = cardPalaceId(cards[clamped])
  if (currentPalace == null) {
    const nextIndex = Math.min(clamped + 1, Math.max(0, cards.length - 1))
    return { cards, nextIndex }
  }
  const next = cards.filter((card, index) => {
    if (index < clamped) return true
    return cardPalaceId(card) !== currentPalace
  })
  const nextIndex = Math.min(clamped, Math.max(0, next.length - 1))
  return { cards: next, nextIndex: next.length === 0 ? 0 : nextIndex }
}

export function mergeRefreshQueue(
  _previous: FreestyleCard[],
  incoming: FreestyleCard[],
): FreestyleCard[] {
  return incoming
}

export function visibleMountIndices(currentIndex: number, total: number) {
  // current, previous, and next two for preload
  const indices = new Set<number>()
  for (const offset of [-1, 0, 1, 2]) {
    const index = currentIndex + offset
    if (index >= 0 && index < total) indices.add(index)
  }
  return indices
}
