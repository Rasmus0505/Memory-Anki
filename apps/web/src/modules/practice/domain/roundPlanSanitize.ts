import type { FreestyleRoundPlanCard, FreestyleRoundPlanCardStatus, FreestyleRoundPlanState } from './roundPlan'
import { parsePartialSettlements } from './partialSettlement'

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

/** Persisted null must stay null. Number(null) is 0, which is not a rating. */
function asStoredRating(value: unknown): number | null {
  if (value == null || value === '') return null
  const rating = Number(value)
  return Number.isInteger(rating) && rating >= 1 && rating <= 4 ? rating : null
}

export function asStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const id = asString(item)
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [id]
  })
}

function asCountMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, count]) => [key, Math.max(0, Math.round(Number(count) || 0))] as const,
  )
  return entries.length ? Object.fromEntries(entries) : undefined
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
      lastRating: asStoredRating(item.lastRating),
      retryAfterCards: Math.max(0, Math.min(3, Math.round(Number(item.retryAfterCards) || 0))),
      attemptCount: Math.max(0, Math.round(Number(item.attemptCount) || 0)),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : 0,
      enteredOn: asString(item.enteredOn) || undefined,
      ...(item.isNew === true ? { isNew: true } : {}),
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
  const compressedIds = asStringList(raw.compressedIds)
  const compressed = new Set(compressedIds)
  // Stale is a transient recovery marker, not a review outcome. Old persisted
  // markers must not make the next fresh queue look empty or require manual work.
  Object.keys(cardsById).forEach((id) => {
    if (cardsById[id].status === 'stale' || compressed.has(id)) delete cardsById[id]
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
    compressedIds,
    partialSettlements: parsePartialSettlements(raw.partialSettlements),
    palaceUnitTotals: asCountMap(raw.palaceUnitTotals),
  })
}

export function collapseRetryPlanEntries(plan: FreestyleRoundPlanState): FreestyleRoundPlanState {
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
