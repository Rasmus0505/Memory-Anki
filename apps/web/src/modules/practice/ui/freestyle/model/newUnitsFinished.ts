import { sourceCardId, type FreestyleRoundPlanState, type FreestyleUnitEncounterState } from '@/modules/practice/public'
import { isOccurrencePassed } from '@/modules/practice/domain/unitProgressState'
import type { FreestyleCard } from '@/shared/api/contracts'
import { isReviewHintId } from '@/shared/api/contracts'

/** A unit is new when it has never passed. The queue builder marks it on the card or in the round plan. */
function isNewUnitCard(card: FreestyleCard, roundPlan: FreestyleRoundPlanState | null) {
  return ('is_new' in card && card.is_new === true) || roundPlan?.cardsById[card.id]?.isNew === true
}

/**
 * Count of new units in the round that have not passed yet. A unit is one source
 * card family: a failed occurrence plus its later passed 重练 is settled, not pending.
 */
export function countPendingNewUnits(
  cards: ReadonlyArray<FreestyleCard>,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  roundPlan: FreestyleRoundPlanState | null = null,
): number {
  const completed = Array.from(completedIds, String)
  const progressInput = { completedIds: completed, encounters: encountersByCardId, roundPlan }
  const families = new Map<string, { isNew: boolean; passed: boolean }>()
  for (const card of cards) {
    if (isReviewHintId(card.id)) continue
    if (roundPlan?.cardsById[card.id]?.status === 'excluded') continue
    const key = sourceCardId(card) || card.id
    const current = families.get(key) ?? { isNew: false, passed: false }
    if (isNewUnitCard(card, roundPlan)) current.isNew = true
    if (isOccurrencePassed(card.id, progressInput)) current.passed = true
    families.set(key, current)
  }
  let pending = 0
  families.forEach((family) => {
    if (family.isNew && !family.passed) pending += 1
  })
  return pending
}

/**
 * Once-per-round trigger for the 「今日新学已完成」 banner. It fires only on the
 * transition from some pending new units to none, within the same round.
 * A round that opens with no new units left never fires.
 */
export interface NewUnitsBannerTracker {
  roundId: string | null
  sawPending: boolean
  shownFor: string | null
}

export const INITIAL_NEW_UNITS_BANNER_TRACKER: NewUnitsBannerTracker = {
  roundId: null,
  sawPending: false,
  shownFor: null,
}

export function advanceNewUnitsBanner(
  tracker: NewUnitsBannerTracker,
  roundId: string,
  pending: number,
): { tracker: NewUnitsBannerTracker; show: boolean } {
  const base = tracker.roundId === roundId
    ? tracker
    : { roundId, sawPending: false, shownFor: null }
  if (pending > 0) {
    // Return the same tracker when nothing changed. The page stores whatever
    // object comes back and re-runs its effect on a new identity, so a fresh
    // object every render is an update-depth loop.
    if (base.sawPending) return { tracker: base, show: false }
    return { tracker: { ...base, sawPending: true }, show: false }
  }
  const show = base.sawPending && base.shownFor !== roundId
  return {
    tracker: show ? { ...base, shownFor: roundId } : base,
    show,
  }
}
