import type { FreestyleCard } from '@/shared/api/contracts'

export type FreestyleSkipState = {
  roundId: string
  startedAt: number
  seed: number
  skipCountById: Record<string, number>
  hiddenIds: string[]
  completedIds: string[]
  mutedPalaceIds: number[]
  /**
   * Palaces deferred via「下个宫殿」. Incomplete cards for these palaces are
   * kept at the tail after local reorder and after queue rebuilds.
   */
  deferredPalaceIds: number[]
  lastSkippedId: string | null
  lastSkippedAt: number | null
  /**
   * Last card under the freestyle viewport. Survives route leave / remount so
   * returning from palace edit (or other pages) resumes the same unit.
   */
  currentCardId: string | null
}

export const DEFAULT_QUEUE_STATE: FreestyleSkipState = {
  roundId: 'freestyle-round-default',
  startedAt: 0,
  seed: 17,
  skipCountById: {},
  hiddenIds: [],
  completedIds: [],
  mutedPalaceIds: [],
  deferredPalaceIds: [],
  lastSkippedId: null,
  lastSkippedAt: null,
  currentCardId: null,
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

/**
 * Start a fresh freestyle round: clear completed / hidden / skip / deferred so
 * still-due units can reappear. Keeps muted palaces (user preference).
 */
export function startNewRound(
  state: FreestyleSkipState,
  seed = state.seed,
  now = Date.now(),
): FreestyleSkipState {
  return {
    ...createQueueRoundState(seed, now),
    mutedPalaceIds: [...state.mutedPalaceIds],
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
    deferredPalaceIds: asIdList(raw.deferredPalaceIds),
    lastSkippedId: typeof raw.lastSkippedId === 'string' ? raw.lastSkippedId : null,
    lastSkippedAt:
      typeof raw.lastSkippedAt === 'number' && Number.isFinite(raw.lastSkippedAt)
        ? raw.lastSkippedAt
        : null,
    currentCardId:
      typeof raw.currentCardId === 'string' && raw.currentCardId.trim()
        ? raw.currentCardId.trim()
        : null,
  }
}

function positivePalaceId(value: unknown): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Stable palace identity for freestyle feed cards.
 * Mind-map / Anki cards prefer ``palace_id``; quiz/action fall back to
 * ``palace_context.id``. Coerces numeric strings so same-palace grouping never
 * fails a ``===`` check (which would make「下个宫殿」look like「下一题」).
 */
export function cardPalaceId(card: FreestyleCard | null | undefined): number | null {
  if (!card) return null
  if (card.type === 'mindmap_branch' || card.type === 'anki_card') {
    return (
      positivePalaceId(card.palace_id) ??
      positivePalaceId(card.palace_context?.id)
    )
  }
  if (card.type === 'quiz_question') {
    return positivePalaceId(card.palace_context?.id)
  }
  return positivePalaceId(card.palace_context?.id)
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

/**
 * Silent rebuild after settle / answer: keep the local feed order under the
 * viewport so completion never looks like auto-advance to the next card.
 *
 * Previous cards stay in place when they are completed (swipe-back history) or
 * still present in the server feed. Completed cards that left the due set are
 * NOT prepended — prepending used to move the settled unit to index 0 while
 * scrollTop stayed put, so the user visually jumped to the next unit.
 * New incoming cards that are not already local append at the tail.
 */
export function mergeQueuePreservingHistory(
  previous: FreestyleCard[],
  incoming: FreestyleCard[],
  completedIds: Iterable<string>,
): FreestyleCard[] {
  const completed = new Set(
    Array.from(completedIds, (id) => String(id || '').trim()).filter(Boolean),
  )
  if (previous.length === 0) return incoming

  const incomingById = new Map(incoming.map((card) => [card.id, card]))
  const used = new Set<string>()
  const result: FreestyleCard[] = []

  previous.forEach((card) => {
    const id = card.id
    if (used.has(id)) return
    if (completed.has(id)) {
      // Keep settled unit where the learner finished it (payload may be gone from due feed).
      result.push(card)
      used.add(id)
      return
    }
    const refreshed = incomingById.get(id)
    if (refreshed) {
      result.push(refreshed)
      used.add(id)
    }
    // Incomplete card no longer in feed → drop (stale due / deferred elsewhere).
  })

  incoming.forEach((card) => {
    if (used.has(card.id)) return
    result.push(card)
    used.add(card.id)
  })

  return result
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

/**
 * Max other cards between a 忘记/困难 settle and the next appearance of that unit.
 *
 * Product example: after unit 1 is weak-rated, the feed may show 2 → 3 → 4, then
 * unit 1 must reappear (at most three intervening cards). If only 2 remains, place
 * after 2 (end of remaining queue). Not a clock delay and not full end-of-batch tail.
 */
export const RESTUDY_MAX_INTERVENING = 3

/**
 * @deprecated Prefer {@link placeRestudyCardWithMaxGap}. Kept for callers that still
 * want explicit tail placement (e.g. skip-to-tail UX).
 */
export function placeRestudyCardAtTail(
  cards: FreestyleCard[],
  cardId: string,
): FreestyleCard[] {
  return moveCardToTail(cards, cardId)
}

/**
 * Re-insert a weak-rated unit so it returns after at most ``maxIntervening`` other
 * cards (default {@link RESTUDY_MAX_INTERVENING}). If fewer cards remain after the
 * unit, it is placed at the end of the remaining queue.
 *
 * When ``fromIndex`` is omitted, the card's current index is used. Never reorders
 * when the card is missing.
 */
export function placeRestudyCardWithMaxGap(
  cards: FreestyleCard[],
  cardId: string,
  options?: { fromIndex?: number; maxIntervening?: number },
): FreestyleCard[] {
  const id = String(cardId || '').trim()
  if (!id || !cards.length) return cards
  const found = cards.findIndex((card) => card.id === id)
  if (found < 0) return cards

  const maxIntervening = Math.max(
    0,
    Math.round(Number(options?.maxIntervening ?? RESTUDY_MAX_INTERVENING) || 0),
  )
  const fromIndex =
    typeof options?.fromIndex === 'number' && Number.isFinite(options.fromIndex)
      ? Math.max(0, Math.min(Math.round(options.fromIndex), cards.length - 1))
      : found

  // Anchor on the weak unit's real slot when fromIndex points elsewhere (stale leave).
  const removeAt = cards[fromIndex]?.id === id ? fromIndex : found
  const next = cards.slice()
  const [card] = next.splice(removeAt, 1)
  // After removal, cards that followed the unit start at ``removeAt``.
  // Insert after up to maxIntervening of those (or at the end if fewer remain).
  const insertAt = Math.min(removeAt + maxIntervening, next.length)
  next.splice(insertAt, 0, card)
  return next
}

/**
 * True when this formal pass still has 忘记/困难 scores that need another restudy
 * pass before graduating to long-interval FSRS.
 */
export function needsRestudyAfterRatings(
  ratingCounts:
    | Partial<Record<'忘记' | '困难' | '记得' | '轻松' | 'forgot' | 'hard', number>>
    | null
    | undefined,
): boolean {
  if (!ratingCounts) return false
  const weak =
    Number(ratingCounts['忘记'] ?? ratingCounts.forgot ?? 0) +
    Number(ratingCounts['困难'] ?? ratingCounts.hard ?? 0)
  return weak > 0
}

/**
 * Prefer card id after a weak-rating settle.
 *
 * Always stays on the restudied unit — freestyle never auto-flips after rating.
 * Gap re-insertion (max intervening cards) runs when the learner leaves the unit.
 */
export function resolveRestudyPreferCardId(args: {
  previousCards: ReadonlyArray<{ id: string }>
  nextCards: ReadonlyArray<{ id: string }>
  restudyCardId: string
  completedIds?: Iterable<string>
}): string | null {
  const { nextCards, restudyCardId } = args
  if (!restudyCardId) return null
  if (nextCards.some((card) => card.id === restudyCardId)) return restudyCardId
  return null
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
 * Record a palace as deferred (「下个宫殿」). Later rebuilds keep its incomplete
 * cards at the tail. Re-deferring moves it to the end of the defer list.
 */
export function deferPalace(state: FreestyleSkipState, palaceId: number): FreestyleSkipState {
  if (!Number.isInteger(palaceId) || palaceId <= 0) return state
  const rest = state.deferredPalaceIds.filter((id) => id !== palaceId)
  return {
    ...state,
    deferredPalaceIds: [...rest, palaceId],
  }
}

/**
 * Keep incomplete cards of deferred palaces at the tail (in defer order).
 * Completed cards stay where they are so swipe-back history is preserved.
 */
export function applyDeferredPalaceOrder(
  cards: FreestyleCard[],
  deferredPalaceIds: number[],
  completedIds: Iterable<string> = [],
): FreestyleCard[] {
  if (!cards.length || !deferredPalaceIds.length) return cards
  const completed = new Set(
    Array.from(completedIds, (id) => String(id || '').trim()).filter(Boolean),
  )
  const deferredSet = new Set(deferredPalaceIds)
  const front: FreestyleCard[] = []
  const buckets = new Map<number, FreestyleCard[]>()
  deferredPalaceIds.forEach((id) => buckets.set(id, []))

  cards.forEach((card) => {
    const palaceId = cardPalaceId(card)
    if (
      palaceId != null &&
      deferredSet.has(palaceId) &&
      !completed.has(card.id)
    ) {
      buckets.get(palaceId)?.push(card)
      return
    }
    front.push(card)
  })

  const tail: FreestyleCard[] = []
  deferredPalaceIds.forEach((id) => {
    const bucket = buckets.get(id)
    if (bucket?.length) tail.push(...bucket)
  })
  if (!tail.length) return cards
  return [...front, ...tail]
}

/**
 * Move the current card and every later card from the same palace to the tail
 * so the queue lands on the next palace. Earlier cards (history) stay put.
 *
 * When no other palace remains in the queue, remaining cards of this palace are
 * removed from the local feed (still tracked via deferredPalaceIds so rebuilds
 * put them last instead of reappearing at the front).
 */
export function moveRemainingPalaceToTail(
  cards: FreestyleCard[],
  currentIndex: number,
): { cards: FreestyleCard[]; nextIndex: number; deferredPalaceId: number | null } {
  if (!cards.length) return { cards: [], nextIndex: 0, deferredPalaceId: null }
  const clamped = Math.max(0, Math.min(currentIndex, cards.length - 1))
  const currentPalace = cardPalaceId(cards[clamped])
  if (currentPalace == null) {
    const nextIndex = Math.min(clamped + 1, Math.max(0, cards.length - 1))
    return { cards, nextIndex, deferredPalaceId: null }
  }

  const head: FreestyleCard[] = []
  const deferred: FreestyleCard[] = []
  const rest: FreestyleCard[] = []
  cards.forEach((card, index) => {
    if (index < clamped) {
      head.push(card)
      return
    }
    if (cardPalaceId(card) === currentPalace) {
      deferred.push(card)
      return
    }
    rest.push(card)
  })

  // No other palace left: drop remaining same-palace cards for now (deferred list
  // will restore them at the tail on the next rebuild).
  if (rest.length === 0) {
    return {
      cards: head,
      nextIndex: head.length === 0 ? 0 : Math.min(clamped, head.length - 1),
      deferredPalaceId: currentPalace,
    }
  }

  return {
    cards: [...head, ...rest, ...deferred],
    nextIndex: head.length,
    deferredPalaceId: currentPalace,
  }
}

export function mergeRefreshQueue(
  _previous: FreestyleCard[],
  incoming: FreestyleCard[],
): FreestyleCard[] {
  return incoming
}

/** Max cards remembered for freestyle 「上一张」/swipe-back after reorders. */
export const VIEW_HISTORY_MAX = 40

/**
 * Remember a card the learner just left so 「上一张」can return even when skip /
 * restudy reorders the feed and the previous unit is no longer at index-1
 * (or when the next unit slides into index 0 and index-based back is disabled).
 */
export function pushViewHistory(
  history: readonly string[],
  leavingCardId: string | null | undefined,
  options?: { max?: number },
): string[] {
  const id = leavingCardId ? String(leavingCardId).trim() : ''
  if (!id) return history.slice()
  if (history[history.length - 1] === id) return history.slice()
  const max = Math.max(1, Math.round(Number(options?.max ?? VIEW_HISTORY_MAX) || VIEW_HISTORY_MAX))
  const next = [...history, id]
  return next.length > max ? next.slice(next.length - max) : next
}

/**
 * Pop the most recent still-present card from view history (skip missing / current).
 * Returns null when nothing remains to go back to.
 */
export function popViewHistory(
  history: readonly string[],
  cards: ReadonlyArray<{ id: string }>,
  currentCardId?: string | null,
): { history: string[]; targetId: string } | null {
  if (!history.length) return null
  const present = new Set(cards.map((card) => card.id))
  const current = currentCardId ? String(currentCardId).trim() : ''
  const next = history.slice()
  while (next.length > 0) {
    const id = next.pop()
    if (!id) continue
    if (!present.has(id)) continue
    if (current && id === current) continue
    return { history: next, targetId: id }
  }
  return null
}

/** True when history still points at a different card present in the feed. */
export function canPopViewHistory(
  history: readonly string[],
  cards: ReadonlyArray<{ id: string }>,
  currentCardId?: string | null,
): boolean {
  return popViewHistory(history, cards, currentCardId) != null
}

export function visibleMountIndices(currentIndex: number, total: number) {
  // Keep two neighbors on each side mounted so swipe-back/forward stays warm
  // (unmounted placeholders used to flash blank content when scrolling up).
  const indices = new Set<number>()
  for (const offset of [-2, -1, 0, 1, 2]) {
    const index = currentIndex + offset
    if (index >= 0 && index < total) indices.add(index)
  }
  return indices
}

/**
 * After a silent queue rebuild, pick the index that follows the user.
 *
 * `preferCardId` (just-finished card) only wins when the user is still on that
 * card. If they already swiped away before the rebuild resolved, keep their card.
 */
export function resolveRebuildIndex(args: {
  nextCards: ReadonlyArray<{ id: string }>
  preferCardId?: string | null
  userCardId?: string | null
  fallbackIndex: number
}): number {
  const { nextCards, preferCardId, userCardId, fallbackIndex } = args
  if (!nextCards.length) return 0

  const findIndex = (id: string | null | undefined) => {
    if (!id) return -1
    return nextCards.findIndex((card) => card.id === id)
  }

  // User already left the preferred card — follow them, never yank back.
  if (preferCardId && userCardId && userCardId !== preferCardId) {
    const userIdx = findIndex(userCardId)
    if (userIdx >= 0) return userIdx
  }

  if (preferCardId) {
    const preferIdx = findIndex(preferCardId)
    if (preferIdx >= 0) return preferIdx
  }

  if (userCardId) {
    const userIdx = findIndex(userCardId)
    if (userIdx >= 0) return userIdx
  }

  return Math.min(Math.max(0, fallbackIndex), nextCards.length - 1)
}
