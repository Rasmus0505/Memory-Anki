import { updateRoundPlanCard, type FreestyleRoundPlanCard, type FreestyleRoundPlanState } from './roundPlan'
import { reviewUnitIdFromCardId, type FreestyleUnitEncounterState } from './queueState'

function planUnitIdentity(card: Pick<FreestyleRoundPlanCard, 'cardId' | 'sourceCardId'>): string {
  return reviewUnitIdFromCardId(card.cardId) || reviewUnitIdFromCardId(card.sourceCardId) || ''
}

/** Same card id, or the same unit after a revision rebind. Never maps a source onto a retry. */
function findHydratedLedgerCard(
  local: FreestyleRoundPlanCard,
  cardsById: Record<string, FreestyleRoundPlanCard>,
): FreestyleRoundPlanCard | undefined {
  const direct = cardsById[local.cardId]
  if (direct?.occurrenceKind === local.occurrenceKind) return direct
  const unitId = planUnitIdentity(local)
  if (!unitId) return undefined
  return Object.values(cardsById).find((item) => {
    if (item.occurrenceKind !== local.occurrenceKind) return false
    if (planUnitIdentity(item) !== unitId) return false
    if (local.occurrenceKind === 'retry' && item.retryAttempt !== local.retryAttempt) return false
    return true
  })
}

function insertExcludedLedgerCard(
  plan: FreestyleRoundPlanState,
  card: FreestyleRoundPlanCard,
  index: number,
): FreestyleRoundPlanState {
  if (plan.cardsById[card.cardId]) {
    return updateRoundPlanCard(plan, card.cardId, { status: 'excluded' })
  }
  const orderIds = [...plan.orderIds]
  const at = Math.max(0, Math.min(index, orderIds.length))
  orderIds.splice(at, 0, card.cardId)
  return {
    ...plan,
    orderIds,
    cardsById: {
      ...plan.cardsById,
      [card.cardId]: { ...card, status: 'excluded' },
    },
  }
}

function encounterLedgerTargetId(
  id: string,
  localPlan: FreestyleRoundPlanState | null,
  cardsById: Record<string, FreestyleRoundPlanCard>,
): string {
  const localCard = localPlan?.cardsById[id]
  if (localCard) return findHydratedLedgerCard(localCard, cardsById)?.cardId ?? id
  if (id.startsWith('retry:')) return id
  const unitId = reviewUnitIdFromCardId(id)
  if (!unitId) return id
  const match = Object.values(cardsById).find(
    (item) => item.occurrenceKind === 'source' && planUnitIdentity(item) === unitId,
  )
  return match?.cardId ?? id
}

export type RetainedRoundLedger = {
  plan: FreestyleRoundPlanState
  completedIds: string[]
  encounters: Record<string, FreestyleUnitEncounterState>
}

/**
 * A silent rebuild hydrates from a server snapshot that may predate this-round
 * scores and a 移除队列. Put those local facts back. Read the local ledger
 * after the await so a cancel that already cleared lastRating stays cleared.
 */
export function retainLocalRoundLedger(input: {
  localPlan: FreestyleRoundPlanState | null
  localCompletedIds: readonly string[]
  localEncounters: Record<string, FreestyleUnitEncounterState>
  hydratedPlan: FreestyleRoundPlanState
  hydratedCompletedIds: readonly string[]
  hydratedEncounters: Record<string, FreestyleUnitEncounterState>
}): RetainedRoundLedger {
  const localPlan = input.localPlan
  let plan = input.hydratedPlan
  if (localPlan) {
    for (const local of Object.values(localPlan.cardsById)) {
      if (local.status !== 'excluded') continue
      const matched = findHydratedLedgerCard(local, plan.cardsById)
      if (matched) {
        if (matched.status !== 'excluded') {
          plan = updateRoundPlanCard(plan, matched.cardId, { status: 'excluded' })
        }
        continue
      }
      const index = localPlan.orderIds.indexOf(local.cardId)
      plan = insertExcludedLedgerCard(plan, local, index < 0 ? plan.orderIds.length : index)
    }
    for (const local of Object.values(localPlan.cardsById)) {
      if (local.lastRating == null || local.status === 'excluded') continue
      const matched = findHydratedLedgerCard(local, plan.cardsById)
      if (!matched || matched.status === 'excluded' || matched.lastRating != null) continue
      const patch: Partial<Omit<FreestyleRoundPlanCard, 'cardId'>> = { lastRating: local.lastRating }
      if (matched.status === 'pending' && (local.status === 'completed' || local.status === 'retry')) {
        patch.status = local.status
      }
      plan = updateRoundPlanCard(plan, matched.cardId, patch)
    }
  }

  const encounters: Record<string, FreestyleUnitEncounterState> = { ...input.hydratedEncounters }
  for (const [rawId, localEncounter] of Object.entries(input.localEncounters)) {
    if (localEncounter?.selectedRating == null) continue
    const targetId = encounterLedgerTargetId(rawId, localPlan, plan.cardsById)
    if (encounters[targetId]?.selectedRating != null) continue
    const hydrated = encounters[targetId]
    const selectedRating = localEncounter.selectedRating
    encounters[targetId] = {
      encounterId: hydrated?.encounterId || localEncounter.encounterId || targetId,
      roundId: hydrated?.roundId || localEncounter.roundId,
      unitRevision: hydrated?.unitRevision || localEncounter.unitRevision || 0,
      status: 'closed',
      sessionId: hydrated?.sessionId ?? localEncounter.sessionId ?? null,
      selectedRating,
      passed: localEncounter.passed ?? selectedRating >= 3,
      retryAfterCards: hydrated?.retryAfterCards ?? localEncounter.retryAfterCards ?? 0,
      effectiveSeconds: hydrated?.effectiveSeconds ?? localEncounter.effectiveSeconds ?? null,
    }
  }

  const completedIds: string[] = []
  const seen = new Set<string>()
  const pushCompleted = (raw: string) => {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) return
    seen.add(id)
    completedIds.push(id)
  }
  for (const id of input.hydratedCompletedIds) pushCompleted(id)
  for (const raw of input.localCompletedIds) {
    const id = String(raw || '').trim()
    if (!id) continue
    const localCard = localPlan?.cardsById[id]
    if (localCard?.status === 'excluded') continue
    if (localCard?.status === 'pending' && localCard.lastRating == null) continue
    if (!localCard) {
      pushCompleted(id)
      continue
    }
    const matched = findHydratedLedgerCard(localCard, plan.cardsById)
    if (matched?.status === 'excluded') continue
    pushCompleted(matched?.cardId ?? id)
  }

  return { plan, completedIds, encounters }
}

