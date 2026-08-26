import { describe, expect, it } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildFreestyleRoundCompletion,
  isFreestyleRoundComplete,
} from './roundCompletion'

function card(id: string): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '宫殿 A',
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: id }],
    node_uids: [`${id}-node`],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  }
}

function encounter(
  overrides: Partial<FreestyleUnitEncounterState> = {},
): FreestyleUnitEncounterState {
  return {
    encounterId: 'e-1',
    roundId: 'round-1',
    unitRevision: 1,
    status: 'closed',
    sessionId: 's-1',
    selectedRating: 3,
    passed: true,
    retryAfterCards: 0,
    ...overrides,
  }
}

describe('buildFreestyleRoundCompletion', () => {
  it('splits ratings into passed and retry', () => {
    const cards = [card('one'), card('two'), card('three')]
    const completion = buildFreestyleRoundCompletion(cards, {
      one: encounter(),
      two: encounter({ selectedRating: 1, passed: false }),
      three: encounter({ selectedRating: 4 }),
    }, 3)

    expect(completion.ratedCount).toBe(3)
    expect(completion.passedCount).toBe(2)
    expect(completion.retryCount).toBe(1)
    expect(completion.retriedCount).toBe(1)
  })

  it('counts a failed source and its later passed retry as one restudied unit', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const completion = buildFreestyleRoundCompletion(
      [card('one'), card('two'), retry],
      {
        one: encounter(),
        two: encounter({ selectedRating: 1, passed: false }),
        [retry.id]: encounter({ selectedRating: 3, passed: true }),
      },
      9,
      { scheduledCount: 2 },
    )

    expect(completion.ratedCount).toBe(2)
    expect(completion.passedCount).toBe(2)
    expect(completion.retriedCount).toBe(1)
    expect(completion.remainingCandidates).toBe(7)
  })

  it('treats acknowledged cards as handled without an encounter', () => {
    const cards = [card('one'), card('quiz-1')]
    expect(isFreestyleRoundComplete(cards, { one: encounter() })).toBe(false)
    expect(isFreestyleRoundComplete(cards, { one: encounter() }, ['quiz-1'])).toBe(true)

    const completion = buildFreestyleRoundCompletion(
      cards,
      { one: encounter() },
      2,
      { completedIds: ['quiz-1'], scheduledCount: 2 },
    )
    expect(completion.ratedCount).toBe(2)
    expect(completion.passedCount).toBe(2)
  })

  it('ignores cards the learner never rated', () => {
    const cards = [card('one'), card('two')]
    const completion = buildFreestyleRoundCompletion(cards, {
      one: encounter(),
      two: encounter({ selectedRating: null, passed: null, status: 'open' }),
    }, 2)

    expect(completion.ratedCount).toBe(1)
    expect(completion.passedCount).toBe(1)
    expect(completion.retryCount).toBe(0)
  })

  it('reports candidates the round limit left out', () => {
    const cards = [card('one'), card('two')]
    const completion = buildFreestyleRoundCompletion(cards, { one: encounter() }, 9)

    expect(completion.remainingCandidates).toBe(7)
  })

  it('never reports negative remaining candidates', () => {
    const cards = [card('one'), card('two'), card('three')]
    // Restudy re-insertion can push the feed past the original candidate count.
    const completion = buildFreestyleRoundCompletion(cards, {}, 2, { scheduledCount: 2 })

    expect(completion.remainingCandidates).toBe(0)
  })
})

describe('isFreestyleRoundComplete', () => {
  it('is complete only once every unit passes, including a weak-rating retry', () => {
    const cards = [card('one'), card('two')]

    expect(isFreestyleRoundComplete(cards, { one: encounter() })).toBe(false)
    expect(isFreestyleRoundComplete(cards, {
      one: encounter(),
      two: encounter({ selectedRating: 2, passed: false }),
    })).toBe(false)

    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(isFreestyleRoundComplete([cards[0], cards[1], retry], {
      one: encounter(),
      two: encounter({ selectedRating: 2, passed: false }),
      [retry.id]: encounter({ selectedRating: 3, passed: true }),
    })).toBe(true)
  })

  it('is never complete for an empty feed', () => {
    // Empty round shows the empty state, not a summary.
    expect(isFreestyleRoundComplete([], {})).toBe(false)
  })

  it('is incomplete while a card holds an open unrated encounter', () => {
    const cards = [card('one')]

    expect(isFreestyleRoundComplete(cards, {
      one: encounter({ selectedRating: null, passed: null, status: 'open' }),
    })).toBe(false)
  })
})
