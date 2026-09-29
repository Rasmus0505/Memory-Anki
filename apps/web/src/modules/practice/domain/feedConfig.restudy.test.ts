import { describe, expect, it } from 'vitest'
import {
  cardPalaceId,
  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  nextRetryAttempt,
  resolveLeaveConfirmViewportId,
  isImmediateRestudyGap,
  restudyInterveningGap,
  placeRestudyCardWithMaxGap,
} from './queueState'
import type { FreestyleCard } from '@/shared/api/contracts'

describe('restudy placement counts every presented card', () => {
  function branch(id: string, palaceId: number): FreestyleCard {
    return { id, type: 'mindmap_branch', palace_id: palaceId } as FreestyleCard
  }

  it('keeps a retry occurrence inside the palace when no same-palace cards follow', () => {
    const cards = [branch('a1', 1), branch('a2', 1), branch('b1', 2), branch('b2', 2)]
    const occurrence = createRetryOccurrence(cards[1], 'round-1', 2, 3)
    const next = insertRetryOccurrenceAfterGap(cards, occurrence, 1, 3)
    expect(next.map((card) => card.id)).toEqual(['a1', 'a2', 'b1', 'b2', occurrence.id])
  })

  it('places a retry occurrence at the palace tail when fewer than gap same-palace cards remain', () => {
    const cards = [
      branch('a1', 1),
      branch('a2', 1),
      branch('a3', 1),
      branch('a4', 1),
      branch('b1', 2),
      branch('b2', 2),
      branch('b3', 2),
    ]
    const occurrence = createRetryOccurrence(cards[1], 'round-1', 2, 3)
    const next = insertRetryOccurrenceAfterGap(cards, occurrence, 1, 3)
    expect(next.map((card) => card.id)).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
      'b1',
      occurrence.id,
      'b2',
      'b3',
    ])
  })

  it('keeps the max-gap rule when enough same-palace cards remain', () => {
    const cards = [
      branch('a1', 1),
      branch('a2', 1),
      branch('a3', 1),
      branch('a4', 1),
      branch('a5', 1),
      branch('b1', 2),
    ]
    const occurrence = createRetryOccurrence(cards[1], 'round-1', 2, 3)
    const next = insertRetryOccurrenceAfterGap(cards, occurrence, 1, 3)
    expect(next.map((card) => card.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', occurrence.id, 'b1'])
  })

  it('counts quiz cards toward the retry gap', () => {
    const cards = [
      branch('a1', 1),
      { id: 'q1', type: 'quiz_question' } as FreestyleCard,
      { id: 'q2', type: 'quiz_question' } as FreestyleCard,
      { id: 'q3', type: 'quiz_question' } as FreestyleCard,
      branch('b1', 2),
    ]
    const occurrence = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const next = insertRetryOccurrenceAfterGap(cards, occurrence, 0, 3)
    expect(next.map((card) => card.id)).toEqual(['a1', 'q1', 'q2', 'q3', occurrence.id, 'b1'])
    expect(cardPalaceId(next[4])).toBe(1)
  })


  it('never inserts a retry as the next card when other cards remain', () => {
    const cards = [branch('a', 1), branch('b', 1), branch('c', 1), branch('d', 1)]
    const occurrence = createRetryOccurrence(cards[0], 'round-1', 1, 0)
    const next = insertRetryOccurrenceAfterGap(cards, occurrence, 0, 0)
    expect(next[1].id).toBe('b')
    expect(next.map((card) => card.id)).toEqual(['a', 'b', 'c', 'd', occurrence.id])
  })

  it('allows immediate retry only when nothing else remains', () => {
    const cards = [branch('a', 1)]
    const occurrence = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const next = insertRetryOccurrenceAfterGap(cards, occurrence, 0, 3)
    expect(next.map((card) => card.id)).toEqual(['a', occurrence.id])
  })

  it('places a retry after the remaining 1-2 cards instead of waiting for a full 3', () => {
    const cards = [branch('a', 1), branch('b', 1)]
    const occurrence = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    expect(insertRetryOccurrenceAfterGap(cards, occurrence, 0, 3).map((card) => card.id)).toEqual([
      'a',
      'b',
      occurrence.id,
    ])
  })

  it('does not borrow today-segment cards to fill a leftover retry gap', () => {
    const cards = [branch('a', 1), branch('b', 1), branch('c1', 2), branch('c2', 2), branch('c3', 2)]
    const occurrence = createRetryOccurrence(cards[0], 'round-1', 1, 3)
    const cohortOf = (id: string) => (id.startsWith('c') ? '2026-09-18' : '2026-09-17')
    expect(
      insertRetryOccurrenceAfterGap(cards, occurrence, 0, 3, cohortOf).map((card) => card.id),
    ).toEqual(['a', 'b', occurrence.id, 'c1', 'c2', 'c3'])
  })
  it('keeps a restudied unit inside its palace via placeRestudyCardWithMaxGap', () => {
    const cards = [
      branch('a1', 1),
      branch('a2', 1),
      branch('a3', 1),
      branch('b1', 2),
      branch('b2', 2),
      branch('b3', 2),
    ]
    expect(placeRestudyCardWithMaxGap(cards, 'a1').map((card) => card.id)).toEqual([
      'a2',
      'a3',
      'a1',
      'b1',
      'b2',
      'b3',
    ])
  })
})

describe('restudy gap helpers', () => {
  it('clamps requested 0 to the max gap when other cards remain', () => {
    expect(restudyInterveningGap(5, 0)).toBe(3)
    expect(restudyInterveningGap(2, 0)).toBe(2)
    expect(restudyInterveningGap(1, 3)).toBe(1)
    expect(restudyInterveningGap(0, 3)).toBe(0)
    expect(isImmediateRestudyGap(0)).toBe(true)
    expect(isImmediateRestudyGap(1)).toBe(false)
  })

  it('pins the live viewport after leave, not the source card', () => {
    expect(resolveLeaveConfirmViewportId({ leavingCardId: 'a', liveCardId: 'b' })).toBe('b')
    expect(resolveLeaveConfirmViewportId({ leavingCardId: 'a', liveCardId: 'a' })).toBe('a')
    expect(resolveLeaveConfirmViewportId({ leavingCardId: 'a', liveCardId: null })).toBeNull()
  })

  it('increments retry attempt past an existing occurrence', () => {
    const source = { id: 'a', type: 'mindmap_branch', palace_id: 1 } as FreestyleCard
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    expect(nextRetryAttempt([source], 'a')).toBe(1)
    expect(nextRetryAttempt([source, retry], retry.id)).toBe(2)
    expect(nextRetryAttempt([source, retry], 'a', { a: { attemptCount: 1 } })).toBe(2)
  })
})
