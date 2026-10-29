import type { FreestyleRoundPlanCard, FreestyleRoundPlanState } from './roundPlan'
import type { FreestyleUnitEncounterState } from './queueState'

function ratingPassed(value: unknown): boolean {
  const rating = Math.round(Number(value))
  return rating >= 2
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

/**
 * A 重练 is done only by a pass or an explicit completion. A weak 重练
 * (忘记/困难) stays live and comes back, so it never counts as answered, even
 * after the learner moved on and its attempt number bumped.
 */
function retryAnswered(
  entry: FreestyleRoundPlanCard,
  plan: FreestyleRoundPlanState,
  completedIds: Iterable<string>,
  encounters: Record<string, FreestyleUnitEncounterState>,
): boolean {
  return cardPassedThisRound(entry.cardId, plan, completedIds, encounters)
}

function sourceIdOf(entry: FreestyleRoundPlanCard) {
  return entry.occurrenceKind === 'retry' ? (entry.sourceCardId || entry.cardId) : entry.cardId
}

function sourceHasUnansweredRetry(
  plan: FreestyleRoundPlanState,
  sourceId: string,
  completedIds: Iterable<string>,
  encounters: Record<string, FreestyleUnitEncounterState>,
) {
  return Object.values(plan.cardsById).some((entry) => {
    if (entry.occurrenceKind !== 'retry') return false
    if ((entry.sourceCardId || entry.cardId) !== sourceId) return false
    if (entry.status === 'excluded') return false
    return !retryAnswered(entry, plan, completedIds, encounters)
  })
}

function groupMembers(plan: FreestyleRoundPlanState, sourceId: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    const text = String(id || '').trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    ids.push(text)
  }
  add(sourceId)
  for (const entry of Object.values(plan.cardsById)) {
    if (sourceIdOf(entry) === sourceId) add(entry.cardId)
  }
  return ids
}

/**
 * Cards the learner can 小结算. A group settles when its source passed, or
 * when one of its 重练 was answered (a pass, or a 忘记/困难 the learner already
 * moved past). A group whose 重练 nobody has answered yet stays. Already
 * compressed or excluded cards stay out.
 */
export function compressibleRoundPlanIds(
  plan: FreestyleRoundPlanState | null,
  input: {
    completedIds?: Iterable<string>
    encounters?: Record<string, FreestyleUnitEncounterState>
    liveCardIds?: readonly string[]
  } = {},
): string[] {
  if (!plan) return []
  const completedIds = input.completedIds ?? []
  const encounters = input.encounters ?? {}
  const compressed = new Set(plan.compressedIds ?? [])
  const seenSources = new Set<string>()
  const ids: string[] = []
  const candidates = [
    ...plan.orderIds,
    ...Object.keys(plan.cardsById),
    ...(input.liveCardIds ?? []),
  ]
  for (const raw of candidates) {
    const id = String(raw || '').trim()
    if (!id) continue
    const entry = plan.cardsById[id]
    const sourceId = entry ? sourceIdOf(entry) : id
    if (seenSources.has(sourceId)) continue
    seenSources.add(sourceId)
    if (sourceHasUnansweredRetry(plan, sourceId, completedIds, encounters)) continue
    const members = groupMembers(plan, sourceId)
    if (!members.includes(id)) members.push(id)
    const settled = members.some((member) => {
      if (cardPassedThisRound(member, plan, completedIds, encounters)) return true
      const memberEntry = plan.cardsById[member]
      return memberEntry?.occurrenceKind === 'retry' && retryAnswered(memberEntry, plan, completedIds, encounters)
    })
    if (!settled) continue
    for (const member of members) {
      if (compressed.has(member) || ids.includes(member)) continue
      if (plan.cardsById[member]?.status === 'excluded') continue
      ids.push(member)
    }
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

export function settledIdSet(ids: readonly string[] | null | undefined): Set<string> {
  return new Set((ids ?? []).map((id) => String(id || '').trim()).filter(Boolean))
}

/**
 * A 结算 removes the source and every live retry of that source.
 * Matching only card.id left a retry sibling lit and unreachable.
 */
export function cardSettledOut(
  card: { id?: string; source_card_id?: string | null },
  compressed: ReadonlySet<string>,
): boolean {
  if (!compressed.size) return false
  const id = String(card.id || '').trim()
  const source = String(card.source_card_id || '').trim()
  return Boolean((id && compressed.has(id)) || (source && source !== id && compressed.has(source)))
}

/** Record live retry ids whose source was just settled, so a rebuild cannot put them back. */
export function expandSettledIds(
  ids: readonly string[],
  cards: readonly { id?: string; source_card_id?: string | null }[] = [],
): string[] {
  const settled = settledIdSet(ids)
  if (!settled.size) return []
  let grew = true
  while (grew) {
    grew = false
    for (const card of cards) {
      const id = String(card.id || '').trim()
      const source = String(card.source_card_id || '').trim()
      if (!id || !cardSettledOut({ id, source_card_id: source }, settled)) continue
      if (!settled.has(id)) {
        settled.add(id)
        grew = true
      }
      if (source && !settled.has(source)) {
        settled.add(source)
        grew = true
      }
    }
  }
  return [...settled]
}
