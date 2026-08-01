import { describe, expect, it } from 'vitest'
import {
  findPreviousPalaceIndex,
  getFreestyleRatedCardIds,
  moveRemainingPalaceToTail,
  createRetryOccurrence,
} from './queueState'
import type { FreestyleCard } from '@/shared/api/contracts'

const cards = [
  { id: 'a1', type: 'mindmap_branch', palace_id: 1 },
  { id: 'a2', type: 'mindmap_branch', palace_id: 1 },
  { id: 'b1', type: 'mindmap_branch', palace_id: 2 },
  { id: 'b2', type: 'mindmap_branch', palace_id: 2 },
] as FreestyleCard[]

describe('freestyle palace navigation', () => {
  it('goes to the start of the preceding palace group', () => {
    expect(findPreviousPalaceIndex(cards, 0)).toBeNull()
    expect(findPreviousPalaceIndex(cards, 1)).toBeNull()
    expect(findPreviousPalaceIndex(cards, 2)).toBe(0)
    expect(findPreviousPalaceIndex(cards, 3)).toBe(0)
  })

  it('keeps the final palace visible when no next palace exists', () => {
    const finalPalace = cards.slice(2)
    const result = moveRemainingPalaceToTail(finalPalace, 0)

    expect(result.cards).toBe(finalPalace)
    expect(result.nextIndex).toBe(0)
    expect(result.deferredPalaceId).toBeNull()
  })

  it('treats weak-rated units and their retry occurrences as already rated', () => {
    const source = cards[0]
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const rated = getFreestyleRatedCardIds(
      [source, retry, cards[1], cards[2]],
      [],
      {
        [source.id]: {
          encounterId: 'encounter-1',
          roundId: 'round-1',
          unitRevision: 1,
          status: 'closed',
          sessionId: 'session-1',
          selectedRating: 2,
          passed: false,
          retryAfterCards: 3,
        },
      },
    )

    expect(rated).toEqual(expect.arrayContaining([source.id, retry.id]))
    expect(rated).not.toContain(cards[1].id)
  })
})
