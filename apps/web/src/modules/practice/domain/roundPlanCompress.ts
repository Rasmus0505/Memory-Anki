import type { FreestyleRoundPlanCard, FreestyleRoundPlanState } from './roundPlan'
import type { FreestyleUnitEncounterState } from './queueState'

function ratingPassed(value: unknown): boolean {
  const rating = Math.round(Number(value))
  return rating === 3 || rating === 4
}

function cardPassedThisRound(
  cardId: string,
  plan: FreestyleRoundPlanState,
  completedIds: Iterable<string>,
  encounters: Record<string, FreestyleUnitEncounterState>,
): boolean {
  const id = String(cardId || '').trim()
  if (!id) return false
  if (ratingPassed(encounters[id]?.selectedRating) || encounters[id]?.passed === true) return true
  if (Array.from(completedIds, (item) => String(item || '').trim()).includes(id)) return true
  return ratingPassed(plan.cardsById[id]?.lastRating)
}

function sourceIdOf(entry: FreestyleRoundPlanCard) {
  return entry.occurrenceKind === 'retry' ? (entry.sourceCardId || entry.cardId) : entry.cardId
}

function sourceHasUnfinishedRetry(
  plan: FreestyleRoundPlanState,
  sourceId: string,
  completedIds: Iterable<string>,
  encounters: Record<string, FreestyleUnitEncounterState>,
) {
  return Object.values(plan.cardsById).some((entry) => {
    if (entry.occurrenceKind !== 'retry') return false
    if ((entry.sourceCardId || entry.cardId) !== sourceId) return false
    if (entry.status === 'excluded') return false
    return !cardPassedThisRound(entry.cardId, plan, completedIds, encounters)
  })
}

/** Passed cards with no live 重练. Weak-rated sources stay in the round. */
export function compressibleRoundPlanIds(
  plan: FreestyleRoundPlanState | null,
  input: {
    completedIds?: Iterable<string>
    encounters?: Record<string, FreestyleUnitEncounterState>
  } = {},
): string[] {
  if (!plan) return []
  const completedIds = input.completedIds ?? []
  const encounters = input.encounters ?? {}
  const compressed = new Set(plan.compressedIds ?? [])
  const ids: string[] = []
  for (const id of plan.orderIds) {
    const entry = plan.cardsById[id]
    if (!entry || compressed.has(id) || entry.status === 'excluded') continue
    if (!cardPassedThisRound(id, plan, completedIds, encounters)) continue
    if (sourceHasUnfinishedRetry(plan, sourceIdOf(entry), completedIds, encounters)) continue
    ids.push(id)
  }
  return ids
}

/** Remove passed cards from the working set. The HUD rail shrinks; ratings stay. */
export function compressRoundPlanCards(
  plan: FreestyleRoundPlanState | null,
  cardIds: readonly string[],
): FreestyleRoundPlanState | null {
  if (!plan) return plan
  const ids = [...new Set(cardIds.map((id) => String(id || '').trim()).filter(Boolean))]
  if (!ids.length) return plan
  const compressed = new Set([...(plan.compressedIds ?? []), ...ids])
  const cardsById = { ...plan.cardsById }
  ids.forEach((id) => {
    delete cardsById[id]
  })
  const orderIds = plan.orderIds.filter((id) => !compressed.has(id))
  return {
    ...plan,
    cardsById,
    orderIds,
    compressedIds: [...compressed],
    scheduledCount: orderIds.filter((id) => cardsById[id]?.occurrenceKind !== 'retry').length,
  }
}
