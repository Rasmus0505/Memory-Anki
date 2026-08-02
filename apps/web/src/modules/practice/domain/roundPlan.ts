import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { cardPalaceId } from './queueState'

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
}

export interface FreestyleRoundMeta {
  candidate_count: number
  scheduled_count: number
  queue_limit: number
  limit_reached: boolean
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
    }
  })
  return result
}

export function sanitizeRoundPlan(value: unknown): FreestyleRoundPlanState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const roundId = asString(raw.roundId)
  if (!roundId) return null
  return {
    roundId,
    configSignature: asString(raw.configSignature),
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
    candidateCount: Math.max(0, Math.round(Number(raw.candidateCount) || 0)),
    scheduledCount: Math.max(0, Math.round(Number(raw.scheduledCount) || 0)),
    queueLimit: Math.max(1, Math.round(Number(raw.queueLimit) || 20)),
    limitReached: Boolean(raw.limitReached),
    orderIds: asStringList(raw.orderIds),
    cardsById: asCards(raw.cardsById),
  }
}

export function roundPlanConfigSignature(config: FreestyleFeedConfig) {
  try {
    return JSON.stringify(config)
  } catch {
    return ''
  }
}

export function createRoundPlan(
  roundId: string,
  cards: FreestyleCard[],
  config: FreestyleFeedConfig,
  meta?: Partial<FreestyleRoundMeta>,
  previous?: FreestyleRoundPlanState | null,
  now = Date.now(),
): FreestyleRoundPlanState {
  const nextById: Record<string, FreestyleRoundPlanCard> = {}
  cards.forEach((card) => {
    const id = String(card.id || '').trim()
    if (!id) return
    const existing = previous?.cardsById[id]
    nextById[id] = existing && existing.status !== 'stale' ? existing : {
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
      retryAfterCards: 0,
      attemptCount: 0,
      updatedAt: now,
    }
  })

  // Keep terminal and retry cards from the same round visible in the plan even
  // when the API omits them after a rebuild. This makes stale/blocked work
  // inspectable instead of silently disappearing from the round dialog.
  Object.entries(previous?.cardsById ?? {}).forEach(([id, item]) => {
    if (item.status === 'excluded' || item.status === 'completed' || item.status === 'retry' || item.status === 'stale') {
      nextById[id] = item
    }
  })

  const currentIds = new Set(Object.keys(nextById))
  const previousIds = new Set(previous?.orderIds ?? [])
  // Retry occurrences are local scheduling decisions. Remove their old
  // persisted slots first so a rebuild cannot resurrect the pre-fix tail order.
  const retryIdsInCards = new Set(
    cards
      .filter((card) => card.occurrence_kind === 'retry')
      .map((card) => String(card.id || '').trim())
      .filter(Boolean),
  )
  const orderIds = (previous?.orderIds ?? []).filter(
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

  return {
    roundId,
    configSignature: roundPlanConfigSignature(config),
    createdAt: previous?.createdAt ?? now,
    candidateCount: Math.max(0, Math.round(Number(meta?.candidate_count ?? previous?.candidateCount ?? cards.length) || 0)),
    scheduledCount: Math.max(0, Math.round(Number(meta?.scheduled_count ?? cards.length) || 0)),
    queueLimit: Math.max(1, Math.round(Number(meta?.queue_limit ?? config.queue_length) || config.queue_length)),
    limitReached: Boolean(meta?.limit_reached ?? previous?.limitReached),
    orderIds,
    cardsById: nextById,
  }
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
  if (currentCardId === card.id) return 'active'
  return plan?.cardsById[card.id]?.status === 'stale' ? 'stale' : plan?.cardsById[card.id]?.status === 'retry' ? 'retry' : 'pending'
}
