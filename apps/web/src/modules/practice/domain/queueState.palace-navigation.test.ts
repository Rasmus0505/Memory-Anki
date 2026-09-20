import { describe, expect, it } from 'vitest'
import {
  findPreviousPalaceIndex,
  getFreestylePassedCardIds,
  findEarliestUnratedIndex,
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

  it('keeps a weak-rated source rated and leaves its unfinished retry seekable', () => {
    const source = cards[0]
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const list = [source, retry, cards[1], cards[2]]
    const encounters = {
      [source.id]: {
        encounterId: 'encounter-1',
        roundId: 'round-1',
        unitRevision: 1,
        status: 'closed' as const,
        sessionId: 'session-1',
        selectedRating: 2,
        passed: false,
        retryAfterCards: 3,
      },
    }
    const rated = getFreestyleRatedCardIds(list, [], encounters)

    expect(rated).toContain(source.id)
    expect(rated).not.toContain(retry.id)
    expect(rated).not.toContain(cards[1].id)
    expect(findEarliestUnratedIndex(list, [], encounters)).toBe(1)
  })

  it('keeps a this-round completed id rated when swipe-back opens an empty amend glance', () => {
    const emptyAmend = {
      encounterId: 'enc-open',
      roundId: 'round-1',
      unitRevision: 1,
      status: 'open' as const,
      sessionId: 'session-1',
      selectedRating: null,
      passed: null,
      retryAfterCards: 0,
    }
    expect(getFreestyleRatedCardIds(cards, ['a1'], { a1: emptyAmend })).toContain('a1')
    expect(findEarliestUnratedIndex(cards, ['a1'], { a1: emptyAmend })).toBe(1)
    expect(getFreestylePassedCardIds(cards, ['a1'], { a1: emptyAmend })).toContain('a1')
  })

  it('counts a weak lastRating as rated when the amend glance is empty', () => {
    const emptyAmend = {
      encounterId: 'enc-open',
      roundId: 'round-1',
      unitRevision: 1,
      status: 'open' as const,
      sessionId: 'session-1',
      selectedRating: null,
      passed: null,
      retryAfterCards: 0,
    }
    const roundPlan = {
      cardsById: { a1: { lastRating: 2 } },
    } as never
    expect(getFreestyleRatedCardIds(cards, [], { a1: emptyAmend }, roundPlan)).toContain('a1')
    expect(findEarliestUnratedIndex(cards, [], { a1: emptyAmend }, roundPlan)).toBe(1)
  })

  it('seeks the first unrated card in round order, including skipped-ahead units', () => {
    expect(findEarliestUnratedIndex(cards, ['a1'], {})).toBe(1)
    expect(findEarliestUnratedIndex(cards, ['a1', 'a2', 'b1', 'b2'], {})).toBeNull()
    expect(findEarliestUnratedIndex(
      cards,
      [],
      {
        a2: {
          encounterId: 'encounter-2',
          roundId: 'round-1',
          unitRevision: 1,
          status: 'open',
          sessionId: 'session-2',
          selectedRating: 3,
          passed: true,
          retryAfterCards: 0,
        },
      },
    )).toBe(0)
  })

  it('does not treat a weak rating as passed until its retry passes', () => {
    const source = cards[0]
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const passedBeforeRetry = getFreestylePassedCardIds(
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
    expect(passedBeforeRetry).not.toContain(source.id)

    const passedAfterRetry = getFreestylePassedCardIds(
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
        [retry.id]: {
          encounterId: 'encounter-2',
          roundId: 'round-1',
          unitRevision: 1,
          status: 'closed',
          sessionId: 'session-1',
          selectedRating: 3,
          passed: true,
          retryAfterCards: 0,
        },
      },
    )
    expect(passedAfterRetry).toEqual(expect.arrayContaining([source.id, retry.id]))
  })
})
