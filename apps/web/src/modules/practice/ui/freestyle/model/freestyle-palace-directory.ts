import { cardPalaceId } from '@/modules/practice/domain/queueState'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import type { FreestyleCard } from '@/shared/api/contracts'

/**
 * What a click on the left directory's palace row means.
 *
 * A directory click is navigation, never a scope rewrite: it either opens the
 * palace's own review route or inspects the live round. The one exception is
 * the card currently on screen, which is already where the learner wants to be.
 */
export type PalaceDirectoryClick =
  | { kind: 'ignore' }
  | { kind: 'review'; palaceId: number }
  | { kind: 'inspect' }

export function resolvePalaceDirectoryClick(input: {
  palaceId: number
  currentPalaceId: number | null
  reviewPalaceId: number | null
}): PalaceDirectoryClick {
  if (input.palaceId === input.currentPalaceId) return { kind: 'ignore' }
  if (input.reviewPalaceId != null) return { kind: 'review', palaceId: input.palaceId }
  return { kind: 'inspect' }
}

/**
 * What a directory click resolved to. The calendar is authoritative, so a
 * palace that is not due today can only be explained, never joined.
 */
export type FreestylePalaceJoinState =
  | { kind: 'join'; palaceId: number; title: string }
  | { kind: 'unmarked'; palaceId: number; title: string }
  | { kind: 'not_due'; palaceId: number; title: string; nextReviewDate: string | null }
  | { kind: 'no_units'; palaceId: number; title: string }
  /** Already in this round, but every card of it has this-round score. */
  | { kind: 'scored'; palaceId: number; title: string; cardCount: number }

/**
 * Source cards of this palace that already carry a this-round score. A palace
 * whose live queue cards are gone can still be in the round plan — the queue
 * filters completed cards, so the directory must ask the plan, not `cards`.
 */
export function completedSourceCardIdsForPalace(
  plan: FreestyleRoundPlanState | null,
  palaceId: number,
  completedIds: ReadonlySet<string>,
): string[] {
  if (!plan) return []
  const ids: string[] = []
  for (const [cardId, entry] of Object.entries(plan.cardsById)) {
    if (entry.palaceId !== palaceId) continue
    if (entry.occurrenceKind === 'retry') continue
    if (completedIds.has(cardId) || entry.status === 'completed') ids.push(cardId)
  }
  return ids
}

/** Any source card of this palace known to the round plan, scored or not. */
export function palaceHasPlanCards(
  plan: FreestyleRoundPlanState | null,
  palaceId: number,
): boolean {
  if (!plan) return false
  return Object.values(plan.cardsById).some(
    (entry) => entry.palaceId === palaceId && entry.occurrenceKind !== 'retry',
  )
}

export interface PalaceJumpTarget {
  cardId: string
  /** Every card of that palace already has a this-round score. */
  complete: boolean
}

/**
 * The card a directory jump should land on: the palace's first unscored card in
 * queue order, or its last card when the palace is already scored through.
 *
 * Scored-ness comes from the same kernel the feed uses (`getFreestyleRatedCardIds`
 * on the caller side), so weak ratings and retry occurrences are not mistaken for
 * fresh work by reading `completedIds` alone.
 */
export function findPalaceJumpTarget(
  cards: readonly FreestyleCard[],
  palaceId: number,
  scoredCardIds: ReadonlySet<string>,
): PalaceJumpTarget | null {
  const palaceCards = cards.filter((card) => cardPalaceId(card) === palaceId)
  if (!palaceCards.length) return null
  const firstUnscored = palaceCards.find((card) => !scoredCardIds.has(String(card.id)))
  return firstUnscored
    ? { cardId: firstUnscored.id, complete: false }
    : { cardId: palaceCards[palaceCards.length - 1].id, complete: true }
}
