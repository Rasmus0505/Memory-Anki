import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { queueConstructionSignature } from './feedConfig'
import { bookedRetryAfterCards, cardPalaceId } from './queueState'

export type FreestyleRoundPlanCardStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'retry'
  | 'excluded'
  | 'stale'

export interface FreestyleRoundPlanCard {
  cardId: string
  sourceCardId: string
  occurrenceKind: 'source' | 'retry'
  retryAttempt: number
  palaceId: number | null
  palaceTitle: string
  label: string
  kind: string
  status: FreestyleRoundPlanCardStatus
  lastRating: number | null
  retryAfterCards: number
  attemptCount: number
  updatedAt: number
  enteredOn?: string
}

export interface FreestyleRoundPlanState {
  roundId: string
  configSignature: string
  createdAt: number
  candidateCount: number
  scheduledCount: number
  queueLimit: number
  limitReached: boolean
  orderIds: string[]
  cardsById: Record<string, FreestyleRoundPlanCard>
  today?: string
}

export interface FreestyleRoundMeta {
  candidate_count: number
  scheduled_count: number
  queue_limit: number
  limit_reached: boolean
  palace_leftover_due?: Record<string, number>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asId(value: unknown) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function asStatus(value: unknown): FreestyleRoundPlanCardStatus {
  return value === 'active' || value === 'completed' || value === 'retry' || value === 'excluded' || value === 'stale'
    ? value
    : 'pending'
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const id = asString(item)
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [id]
  })
}

function asCards(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, FreestyleRoundPlanCard> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || !key) return
    const item = raw as Record<string, unknown>
    result[key] = {
      cardId: key,
      sourceCardId: asString(item.sourceCardId) || key,
      occurrenceKind: item.occurrenceKind === 'retry' ? 'retry' : 'source',
      retryAttempt: Math.max(0, Math.round(Number(item.retryAttempt) || 0)),
      palaceId: asId(item.palaceId),
      palaceTitle: asString(item.palaceTitle),
      label: asString(item.label) || key,
      kind: asString(item.kind) || 'card',
      status: asStatus(item.status),
      lastRating: Number.isInteger(Number(item.lastRating)) ? Number(item.lastRating) : null,
      retryAfterCards: Math.max(0, Math.min(3, Math.round(Number(item.retryAfterCards) || 0))),
      attemptCount: Math.max(0, Math.round(Number(item.attemptCount) || 0)),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : 0,
      enteredOn: asString(item.enteredOn) || undefined,
    }
  })
  return result
}

export function sanitizeRoundPlan(value: unknown): FreestyleRoundPlanState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const roundId = asString(raw.roundId)
  if (!roundId) return null
  const cardsById = asCards(raw.cardsById)
  // Stale is a transient recovery marker, not a review outcome. Old persisted
  // markers must not make the next fresh queue look empty or require manual work.
  Object.keys(cardsById).forEach((id) => {
    if (cardsById[id].status === 'stale') delete cardsById[id]
  })
  return collapseRetryPlanEntries({
    roundId,
    configSignature: asString(raw.configSignature),
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    candidateCount: Math.max(0, Math.round(Number(raw.candidateCount) || 0)),
    scheduledCount: Math.max(0, Math.round(Number(raw.scheduledCount) || 0)),
    queueLimit: Math.max(1, Math.round(Number(raw.queueLimit) || 20)),
    limitReached: Boolean(raw.limitReached),
    orderIds: asStringList(raw.orderIds).filter((id) => Boolean(cardsById[id])),
    cardsById,
    today: asString(raw.today) || undefined,
  })
}

function collapseRetryPlanEntries(plan: FreestyleRoundPlanState): FreestyleRoundPlanState {
  const bySource = new Map<string, FreestyleRoundPlanCard[]>()
  Object.values(plan.cardsById).forEach((item) => {
    if (item.occurrenceKind !== 'retry') return
    const source = item.sourceCardId || item.cardId
    const list = bySource.get(source) ?? []
    list.push(item)
    bySource.set(source, list)
  })
  const drop = new Set<string>()
  bySource.forEach((list) => {
    if (list.length <= 1) return
    const live = list.filter((item) => item.status === 'retry' || item.status === 'active' || item.status === 'pending')
    const ranked = (live.length ? live : list)
    const keep = ranked.reduce((best, item) => (item.retryAttempt >= best.retryAttempt ? item : best))
    list.forEach((item) => {
      if (item.cardId !== keep.cardId) drop.add(item.cardId)
    })
  })
  if (!drop.size) return plan
  const cardsById = { ...plan.cardsById }
  drop.forEach((id) => {
    delete cardsById[id]
  })
  return {
    ...plan,
    cardsById,
    orderIds: plan.orderIds.filter((id) => !drop.has(id)),
  }
}

export function roundPlanConfigSignature(config: FreestyleFeedConfig) {
  try {
    return JSON.stringify(config)
  } catch {
    return ''
  }
}

export function shouldReorderUnstartedFreestylePlan(
  previousSignature: string | undefined,
  nextConfig: FreestyleFeedConfig,
) {
  if (!previousSignature) return false
  try {
    return queueConstructionSignature(JSON.parse(previousSignature)) !== queueConstructionSignature(nextConfig)
  } catch {
    return true
  }
}

function lockedPlanIds(cardsById: Record<string, FreestyleRoundPlanCard>) {
  const locked = new Set<string>()
  Object.values(cardsById).forEach((item) => {
    if (item.status === 'completed' || item.status === 'excluded' || item.status === 'retry') {
      locked.add(item.cardId)
    }
    if (item.occurrenceKind === 'retry' || item.status === 'retry') {
      locked.add(item.cardId)
      if (item.sourceCardId) locked.add(item.sourceCardId)
    }
  })
  return locked
}

export function reorderUnstartedPlanIds(
  previousOrder: string[],
  incomingIds: string[],
  cardsById: Record<string, FreestyleRoundPlanCard>,
) {
  const locked = lockedPlanIds(cardsById)
  const incomingUnstarted = incomingIds.filter((id) => id && !locked.has(id))
  const used = new Set<string>()
  const result: string[] = []
  let cursor = 0
  previousOrder.forEach((id) => {
    if (!cardsById[id] || used.has(id)) return
    if (locked.has(id)) {
      result.push(id)
      used.add(id)
      return
    }
    while (
      cursor < incomingUnstarted.length
      && (used.has(incomingUnstarted[cursor]) || !cardsById[incomingUnstarted[cursor]])
    ) {
      cursor += 1
    }
    const next = incomingUnstarted[cursor]
    if (!next) return
    result.push(next)
    used.add(next)
    cursor += 1
  })
  incomingUnstarted.forEach((id) => {
    if (!used.has(id) && cardsById[id]) {
      result.push(id)
      used.add(id)
    }
  })
  return result
}

export function createRoundPlan(
  roundId: string,
  cards: FreestyleCard[],
  config: FreestyleFeedConfig,
  meta?: Partial<FreestyleRoundMeta>,
  previous?: FreestyleRoundPlanState | null,
  now = Date.now(),
): FreestyleRoundPlanState {
  // Never inherit another round's completed/retry ledger into this plan — that
  // left phantom 待重练 rows in 本轮安排 and blocked locate/settlement.
  const prior = previous?.roundId === roundId ? previous : null
  const nextById: Record<string, FreestyleRoundPlanCard> = {}
  cards.forEach((card) => {
    const id = String(card.id || '').trim()
    if (!id) return
    const existing = prior?.cardsById[id]
    if (existing && existing.status !== 'stale') {
      const retryGap = bookedRetryAfterCards(card)
      nextById[id] = existing.occurrenceKind === 'retry' && existing.retryAfterCards === 0 && retryGap > 0
        ? { ...existing, retryAfterCards: retryGap }
        : existing
    } else {
      nextById[id] = {
        cardId: id,
        sourceCardId: String(card.source_card_id || id),
        occurrenceKind: card.occurrence_kind === 'retry' ? 'retry' : 'source',
        retryAttempt: Math.max(0, Math.round(Number(card.retry_attempt) || 0)),
        palaceId: cardPalaceId(card),
        palaceTitle: cardPalaceTitle(card),
        label: cardLabel(card),
        kind: card.type,
        status: 'pending',
        lastRating: null,
        retryAfterCards: bookedRetryAfterCards(card),
        attemptCount: 0,
        updatedAt: now,
        enteredOn: existing?.enteredOn,
      }
    }
  })

  // Keep terminal and retry cards from the same round visible in the plan even
  // when the API omits them after a rebuild. Stale cards are intentionally not
  // retained: they are rebuildable projections, and retaining them can let an
  // old stale entry overwrite a fresh card with the same stable id.
  const retrySourceKept = new Set(
    Object.values(nextById)
      .filter((item) => item.occurrenceKind === 'retry')
      .map((item) => item.sourceCardId || item.cardId),
  )
  Object.entries(prior?.cardsById ?? {}).forEach(([id, item]) => {
    if (item.status === 'excluded' || item.status === 'completed' || item.status === 'retry') {
      if (item.occurrenceKind === 'retry') {
        // retry:{roundId}:... from another round must not haunt 本轮安排.
        if (id.startsWith('retry:') && !id.startsWith(`retry:${roundId}:`)) return
        const source = item.sourceCardId || item.cardId
        if (nextById[id] || retrySourceKept.has(source)) return
        retrySourceKept.add(source)
      }
      nextById[id] = item.occurrenceKind === 'retry' && item.retryAfterCards === 0
        ? { ...item, retryAfterCards: bookedRetryAfterCards({ occurrence_kind: 'retry', retry_after_cards: 0 }) }
        : item
    }
  })

  const currentIds = new Set(Object.keys(nextById))
  const previousIds = new Set(prior?.orderIds ?? [])
  // Retry occurrences are local scheduling decisions. Remove their old
  // persisted slots first so a rebuild cannot resurrect the pre-leave tail order.
  const retryIdsInCards = new Set(
    cards
      .filter((card) => card.occurrence_kind === 'retry')
      .map((card) => String(card.id || '').trim())
      .filter(Boolean),
  )
  let orderIds = (prior?.orderIds ?? []).filter(
    (id) => currentIds.has(id) && !retryIdsInCards.has(id),
  )
  cards.forEach((card, cardIndex) => {
    const id = String(card.id || '').trim()
    if (!id || !currentIds.has(id)) return
    if (card.occurrence_kind === 'retry' && card.source_card_id) {
      // The queue reducer already placed this retry occurrence using the
      // current-palace boundary. Preserve that physical position during a
      // rebuild instead of recomputing from the source card's old plan slot.
      const previousKnownId = cards
        .slice(0, cardIndex)
        .map((item) => String(item.id || '').trim())
        .reverse()
        .find((candidate) => candidate && orderIds.includes(candidate))
      const previousIndex = previousKnownId ? orderIds.indexOf(previousKnownId) : -1
      orderIds.splice(previousIndex + 1, 0, id)
      return
    }
    if (previousIds.has(id)) return
    orderIds.push(id)
  })
  if (shouldReorderUnstartedFreestylePlan(prior?.configSignature, config)) {
    orderIds = reorderUnstartedPlanIds(
      orderIds,
      cards.map((card) => String(card.id || '').trim()).filter(Boolean),
      nextById,
    )
  }

  return collapseRetryPlanEntries({
    roundId,
    configSignature: roundPlanConfigSignature(config),
    createdAt: prior?.createdAt ?? now,
    candidateCount: Math.max(0, Math.round(Number(meta?.candidate_count ?? prior?.candidateCount ?? cards.length) || 0)),
    scheduledCount: Math.max(0, Math.round(Number(meta?.scheduled_count ?? cards.length) || 0)),
    queueLimit: Math.max(1, Math.round(Number(meta?.queue_limit ?? config.queue_length) || config.queue_length)),
    limitReached: Boolean(meta?.limit_reached ?? prior?.limitReached),
    orderIds,
    cardsById: nextById,
    today: prior?.today,
  })
}

function cardPalaceTitle(card: FreestyleCard) {
  if (card.type === 'quiz_question') return card.palace_context?.resolved_title || card.palace_context?.title || ''
  if ('palace_title' in card) return card.palace_title || ''
  return card.palace_context?.resolved_title || card.palace_context?.title || ''
}

function cardLabel(card: FreestyleCard) {
  if (card.type === 'quiz_question') {
    const stem = String(card.question.stem || '').replace(/\s+/g, ' ').trim()
    return stem ? `题目：${stem.slice(0, 64)}` : `题目 ${card.question.id}`
  }
  if (card.type === 'action') return card.title || card.subtitle || card.id
  return card.type === 'mindmap_branch'
    ? (card.context_path.at(-1)?.text || card.anchor_uid || card.id)
    : (card.anki_front_uid || card.anchor_uid || card.id)
}

export function applyRoundPlanOrder(cards: FreestyleCard[], plan: FreestyleRoundPlanState | null) {
  if (!plan?.orderIds.length) return cards
  const rank = new Map(plan.orderIds.map((id, index) => [id, index]))
  return [...cards].sort((left, right) => {
    const leftRank = rank.get(left.id)
    const rightRank = rank.get(right.id)
    if (leftRank == null && rightRank == null) return 0
    if (leftRank == null) return 1
    if (rightRank == null) return -1
    return leftRank - rightRank
  })
}

export function reorderRoundPlan(plan: FreestyleRoundPlanState, orderIds: string[]) {
  const known = new Set(Object.keys(plan.cardsById))
  const movable = plan.orderIds.filter((id) => {
    const status = plan.cardsById[id]?.status
    return known.has(id) && status !== 'completed' && status !== 'excluded'
  })
  const requested = asStringList(orderIds).filter(
    (id) => known.has(id) && movable.includes(id),
  )
  movable.forEach((id) => {
    if (!requested.includes(id)) requested.push(id)
  })
  let cursor = 0
  const next = plan.orderIds.map((id) => {
    const status = plan.cardsById[id]?.status
    if (status === 'completed' || status === 'excluded') return id
    const replacement = requested[cursor]
    cursor += 1
    return replacement ?? id
  })
  return { ...plan, orderIds: next }
}

export interface RestudyPlanStamp {
  cardId: string
  rating?: number | null
  retryAfterCards: number
  attempt: number
}

/**
 * A 忘记/困难 rating already inserted its retry into ``cards``.
 * Stamp that order onto the round plan so the progress rail shows the amber
 * node immediately, instead of appending it after ``orderIds``.
 */
export function stampRestudyPlan(
  plan: FreestyleRoundPlanState | null,
  cards: FreestyleCard[],
  roundId: string,
  config: FreestyleFeedConfig,
  entries: RestudyPlanStamp[],
  now = Date.now(),
): FreestyleRoundPlanState | null {
  if (!plan && cards.length === 0) return plan
  let next = createRoundPlan(roundId || plan?.roundId || '', cards, config, undefined, plan, now)
  for (const entry of entries) {
    const cardId = String(entry.cardId || '').trim()
    if (!cardId) continue
    const rated = cards.find((card) => card.id === cardId)
    const sourceId = String(rated?.source_card_id || cardId).trim() || cardId
    const retry = cards.find((card) => (
      card.occurrence_kind === 'retry' && String(card.source_card_id || '') === sourceId
    ))
    const ratingTheRetry = Boolean(retry && cardId === retry.id)
    const schedulePatch = {
      status: 'retry' as const,
      retryAfterCards: entry.retryAfterCards,
      attemptCount: entry.attempt,
    }
    if (next.cardsById[cardId]) {
      next = updateRoundPlanCard(next, cardId, {
        ...schedulePatch,
        lastRating: entry.rating ?? next.cardsById[cardId]?.lastRating ?? null,
      }, now)
    }
    // The parent's 忘记/困难 downgrades that card and schedules this glance.
    // It must not prefill the retry rating. A later score on the 重练 stays there.
    if (!ratingTheRetry && sourceId !== cardId && next.cardsById[sourceId]) {
      const priorSource = next.cardsById[sourceId]
      next = updateRoundPlanCard(next, sourceId, {
        ...schedulePatch,
        // Keep the source's own score only; never read a 重练 glance here.
        lastRating: entry.rating ?? priorSource?.lastRating ?? null,
      }, now)
    }
    if (ratingTheRetry && sourceId !== cardId && next.cardsById[sourceId]) {
      next = updateRoundPlanCard(next, sourceId, schedulePatch, now)
    }
    if (!retry || !next.cardsById[retry.id]) continue
    next = updateRoundPlanCard(next, retry.id, {
      status: 'retry',
      occurrenceKind: 'retry',
      sourceCardId: sourceId,
      retryAttempt: Math.max(1, Math.round(Number(retry.retry_attempt) || entry.attempt || 1)),
      retryAfterCards: entry.retryAfterCards,
      lastRating: ratingTheRetry
        ? (entry.rating ?? next.cardsById[retry.id]?.lastRating ?? null)
        : null,
    }, now)
  }
  return next
}

export function updateRoundPlanCard(
  plan: FreestyleRoundPlanState,
  cardId: string,
  patch: Partial<Omit<FreestyleRoundPlanCard, 'cardId'>>,
  now = Date.now(),
) {
  const current = plan.cardsById[cardId]
  if (!current) return plan
  return {
    ...plan,
    cardsById: {
      ...plan.cardsById,
      [cardId]: { ...current, ...patch, updatedAt: now },
    },
  }
}

export function isSequentialPalaceBlocked(
  cards: FreestyleCard[],
  currentIndex: number,
  targetIndex: number,
  completedIds: Iterable<string>,
  palaceOrder: FreestyleFeedConfig['palace_order'],
) {
  if (palaceOrder !== 'finish_palace_then_next') return false
  if (currentIndex === targetIndex || !cards.length) return false
  // Looking back at a previous palace is never a "leave before finishing" move.
  // The old bidirectional gate bounced swipe-back after crossing a palace boundary.
  if (targetIndex < currentIndex) return false
  const currentPalace = cardPalaceId(cards[Math.max(0, Math.min(currentIndex, cards.length - 1))])
  const targetPalace = cardPalaceId(cards[Math.max(0, Math.min(targetIndex, cards.length - 1))])
  if (currentPalace == null || targetPalace === currentPalace) return false
  const completed = new Set(Array.from(completedIds, (id) => String(id || '').trim()).filter(Boolean))
  return cards.some((card) => {
    if (cardPalaceId(card) !== currentPalace || card.type !== 'mindmap_branch' || !card.unit_id) return false
    return !completed.has(card.id)
  })
}

export function countIncompletePalaceUnits(
  cards: FreestyleCard[],
  palaceId: number | null,
  completedIds: Iterable<string>,
): number {
  if (palaceId == null) return 0
  const completed = new Set(
    Array.from(completedIds, (id) => String(id || '').trim()).filter(Boolean),
  )
  let count = 0
  for (const card of cards) {
    if (cardPalaceId(card) !== palaceId || card.type !== 'mindmap_branch' || !card.unit_id) continue
    if (!completed.has(card.id)) count += 1
  }
  return count
}

export function planCardStatus(
  card: FreestyleCard,
  plan: FreestyleRoundPlanState | null,
  completedIds: Iterable<string>,
  hiddenIds: Iterable<string>,
  currentCardId?: string | null,
): FreestyleRoundPlanCardStatus {
  if (hiddenIds && Array.from(hiddenIds, String).includes(card.id)) return 'excluded'
  if (completedIds && Array.from(completedIds, String).includes(card.id)) return 'completed'
  if (plan?.cardsById[card.id]?.status === 'completed') return 'completed'
  if (currentCardId === card.id) return 'active'
  return plan?.cardsById[card.id]?.status === 'stale' ? 'stale' : plan?.cardsById[card.id]?.status === 'retry' ? 'retry' : 'pending'
}

export function applyCompletedIdsToRoundPlan(
  plan: FreestyleRoundPlanState,
  completedIds: Iterable<string>,
) {
  const completed = new Set(Array.from(completedIds, (id) => String(id || '').trim()).filter(Boolean))
  if (!completed.size) return plan
  let next = plan
  for (const id of Object.keys(plan.cardsById)) {
    if (!completed.has(id) || next.cardsById[id]?.status === 'completed') continue
    next = updateRoundPlanCard(next, id, { status: 'completed' })
  }
  return next
}

/** Hydrate from the server completed set, including undoing a cancelled rating. */
export function syncCompletedIdsToRoundPlan(
  plan: FreestyleRoundPlanState,
  completedIds: Iterable<string>,
) {
  const completed = new Set(Array.from(completedIds, (id) => String(id || '').trim()).filter(Boolean))
  let next = applyCompletedIdsToRoundPlan(plan, completed)
  for (const id of Object.keys(next.cardsById)) {
    if (completed.has(id) || next.cardsById[id]?.status !== 'completed') continue
    next = updateRoundPlanCard(next, id, { status: 'pending', lastRating: null })
  }
  return next
}
