import { cardPalaceId } from '@/modules/practice/domain/queueState'
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
