import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'

export interface FreestyleRoundCompletion {
  ratedCount: number
  passedCount: number
  retryCount: number
  /** Candidates the round limit left out, so 「再来一轮」 has an honest expectation. */
  remainingCandidates: number
}

/**
 * A round needs an ending. The feed used to simply run out after the last rate,
 * which is the least satisfying way to close a session.
 *
 * Counts come from encounters rather than the plan: an encounter records what the
 * learner actually did, and survives the silent queue rebuilds that restudy
 * re-insertion triggers.
 */
export function buildFreestyleRoundCompletion(
  cards: FreestyleCard[],
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  candidateCount: number,
): FreestyleRoundCompletion {
  let passedCount = 0
  let retryCount = 0
  let ratedCount = 0
  const seen = new Set<string>()
  for (const card of cards) {
    const encounter = encountersByCardId[card.id]
    if (!encounter || encounter.selectedRating == null) continue
    // Retry occurrences share a source; count the learner's decisions once each.
    if (seen.has(card.id)) continue
    seen.add(card.id)
    ratedCount += 1
    if (encounter.passed) passedCount += 1
    else retryCount += 1
  }
  return {
    ratedCount,
    passedCount,
    retryCount,
    remainingCandidates: Math.max(0, candidateCount - cards.length),
  }
}

/**
 * True only when every card in the feed carries a rating, so the summary slot
 * cannot appear while work is still pending.
 */
export function isFreestyleRoundComplete(
  cards: FreestyleCard[],
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
): boolean {
  if (cards.length === 0) return false
  return cards.every((card) => encountersByCardId[card.id]?.selectedRating != null)
}
