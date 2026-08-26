import {
  isRetryOccurrence,
  sourceCardId,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'

export interface FreestyleRoundCompletion {
  ratedCount: number
  passedCount: number
  /** Sources that were weakly rated at some point this round (already restudied). */
  retriedCount: number
  /** Kept for older callers; same as retriedCount once the round is complete. */
  retryCount: number
  /** Candidates the round limit left out, so 「再来一轮」 has an honest expectation. */
  remainingCandidates: number
}

function sourceIdOf(card: FreestyleCard) {
  return sourceCardId(card) || card.id
}

function encounterPassed(encounter: FreestyleUnitEncounterState | undefined) {
  const rating = Number(encounter?.selectedRating)
  return encounter?.passed === true || (encounter?.passed == null && rating >= 3)
}

function isHandled(
  card: FreestyleCard,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  cards: ReadonlyArray<FreestyleCard> = [card],
) {
  const completed = new Set(Array.from(completedIds, String))
  if (completed.has(card.id) || completed.has(sourceIdOf(card))) return true
  // A weak rating is an acknowledged attempt, but not completion: its retry
  // occurrence must still be rated before the round can close.
  const encounter = encountersByCardId[card.id]
  if (encounterPassed(encounter)) return true
  if (encounter?.selectedRating != null) {
    const sourceId = sourceIdOf(card)
    return cards.some(
      (candidate) => sourceIdOf(candidate) === sourceId
        && encounterPassed(encountersByCardId[candidate.id]),
    )
  }
  return false
}

/**
 * A round needs an ending. The feed used to simply run out after the last rate,
 * which is the least satisfying way to close a session.
 *
 * Counts are source-deduped: a failed source plus its later passed retry is one
 * unit that was restudied, not "passed 1 + still retrying 1". Remaining
 * candidates use the backend scheduled count, never the live feed length
 * (retry insertions must not shrink the leftover).
 */
export function buildFreestyleRoundCompletion(
  cards: FreestyleCard[],
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  candidateCount: number,
  options?: {
    completedIds?: Iterable<string>
    scheduledCount?: number
  },
): FreestyleRoundCompletion {
  const completedIds = options?.completedIds ?? []
  const completed = new Set(Array.from(completedIds, String))
  const scheduledCount = options?.scheduledCount ?? cards.filter((card) => !isRetryOccurrence(card)).length
  const sources = new Map<string, { passed: boolean; retried: boolean; handled: boolean; attempted: boolean }>()

  for (const card of cards) {
    const sourceId = sourceIdOf(card)
    const current = sources.get(sourceId) ?? { passed: false, retried: false, handled: false, attempted: false }
    const encounter = encountersByCardId[card.id]
    const handled = isHandled(card, encountersByCardId, completedIds, cards)
    if (handled) current.handled = true
    if (
      encounter?.selectedRating != null
      || completed.has(card.id)
      || completed.has(sourceId)
    ) {
      current.attempted = true
    }
    if (encounterPassed(encounter) || (handled && !isRetryOccurrence(card) && !encounter)) {
      current.passed = true
    }
    if (isRetryOccurrence(card) || encounter?.passed === false) current.retried = true
    sources.set(sourceId, current)
  }

  let ratedCount = 0
  let passedCount = 0
  let retriedCount = 0
  sources.forEach((entry) => {
    if (!entry.attempted) return
    ratedCount += 1
    if (entry.passed) passedCount += 1
    if (entry.retried) retriedCount += 1
  })

  return {
    ratedCount,
    passedCount,
    retriedCount,
    retryCount: retriedCount,
    remainingCandidates: Math.max(0, candidateCount - scheduledCount),
  }
}

/**
 * True when every card in the feed has been handled: a unit rating, or a quiz
 * acknowledge written to completedIds. Retry occurrences still need their own
 * rating before the summary slot can appear.
 */
export function isFreestyleRoundComplete(
  cards: FreestyleCard[],
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
): boolean {
  if (cards.length === 0) return false
  return cards.every((card) => isHandled(card, encountersByCardId, completedIds, cards))
}
