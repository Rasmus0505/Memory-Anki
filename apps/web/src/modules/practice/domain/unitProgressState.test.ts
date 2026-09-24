import { describe, expect, it } from 'vitest'
import {
  areAllOccurrencesPassed,
  findEarliestUnscoredIndex,
  isOccurrencePassed,
  isOccurrenceScored,
  occurrenceScore,
  scoredOccurrenceIds,
  unscoredOccurrenceIds,
} from './unitProgressState'
import type { FreestyleCard } from '@/shared/api/contracts'
import type { FreestyleRoundPlanState } from './roundPlan'
import type { FreestyleUnitEncounterState } from './queueState'

function card(id: string, source?: string): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    ...(source ? { source_card_id: source, occurrence_kind: 'retry' as const } : {}),
  } as FreestyleCard
}

function enc(selectedRating: number | null): FreestyleUnitEncounterState {
  return {
    encounterId: 'e',
    roundId: 'r',
    unitRevision: 1,
    status: selectedRating == null ? 'open' : 'closed',
    sessionId: 's',
    selectedRating,
    passed: selectedRating == null ? null : selectedRating >= 3,
    retryAfterCards: 0,
  }
}

function plan(entries: Record<string, { lastRating?: number | null; status?: string }>) {
  return {
    roundId: 'r',
    configSignature: 's',
    createdAt: 0,
    candidateCount: 0,
    scheduledCount: 0,
    queueLimit: 0,
    limitReached: false,
    orderIds: Object.keys(entries),
    cardsById: Object.fromEntries(
      Object.entries(entries).map(([cardId, value]) => [
        cardId,
        {
          cardId,
          sourceCardId: cardId,
          occurrenceKind: 'source',
          retryAttempt: 1,
          palaceId: 1,
          palaceTitle: '',
          label: cardId,
          kind: 'mindmap_branch',
          status: (value.status ?? 'pending') as 'pending',
          lastRating: value.lastRating ?? null,
          retryAfterCards: 0,
          attemptCount: 0,
          updatedAt: 0,
        },
      ]),
    ),
  } as FreestyleRoundPlanState
}

describe('occurrenceScore', () => {
  it('reads live encounter before plan lastRating', () => {
    expect(occurrenceScore('a', {
      completedIds: [],
      encounters: { a: enc(2) },
      roundPlan: plan({ a: { lastRating: 4 } }),
    })).toBe(2)
  })

  it('keeps empty-amend this-round score from plan lastRating', () => {
    expect(occurrenceScore('a', {
      completedIds: ['a'],
      encounters: { a: enc(null) },
      roundPlan: plan({ a: { lastRating: 2 } }),
    })).toBe(3)
    expect(isOccurrenceScored('a', {
      completedIds: [],
      encounters: { a: enc(null) },
      roundPlan: plan({ a: { lastRating: 2 } }),
    })).toBe(true)
  })

  it('does not inherit the source score onto a 重练 occurrence', () => {
    // Regression: planRecordedRating(id, sourceId) used to mark this rated.
    const retryId = 'retry:round-1:u1:1'
    expect(occurrenceScore(retryId, {
      completedIds: [],
      encounters: { a: enc(2) },
      roundPlan: plan({ a: { lastRating: 2 }, [retryId]: { lastRating: null } }),
    })).toBeNull()
    expect(isOccurrenceScored(retryId, {
      completedIds: [],
      encounters: { a: enc(2) },
      roundPlan: plan({ a: { lastRating: 2 }, [retryId]: { lastRating: null } }),
    })).toBe(false)
  })

  it('treats weak and pass alike for scored (进度条实心)', () => {
    const weak = { completedIds: [], encounters: { a: enc(1) }, roundPlan: null }
    const pass = { completedIds: [], encounters: { a: enc(3) }, roundPlan: null }
    expect(isOccurrenceScored('a', weak)).toBe(true)
    expect(isOccurrenceScored('a', pass)).toBe(true)
    expect(isOccurrencePassed('a', weak)).toBe(false)
    expect(isOccurrencePassed('a', pass)).toBe(true)
  })
})

describe('findEarliestUnscoredIndex', () => {
  it('takes the queue-order first unscored card (谁最早看谁)', () => {
    const cards = [card('a'), card('b'), card('c')]
    const input = {
      cards,
      completedIds: [],
      encounters: { a: enc(2), c: enc(4) },
      roundPlan: null,
    }
    expect(findEarliestUnscoredIndex(input)).toBe(1)
    expect(unscoredOccurrenceIds(input)).toEqual(['b'])
    expect(scoredOccurrenceIds(input)).toEqual(['a', 'c'])
  })

  it('seeks a blank next-attempt 重练 after its score is cleared', () => {
    const source = card('a')
    const retry = card('retry:round-1:a:2', 'a')
    const cards = [source, retry]
    expect(findEarliestUnscoredIndex({
      cards,
      completedIds: [],
      encounters: { a: enc(2), [retry.id]: enc(null) },
      roundPlan: plan({ a: { lastRating: 2 }, [retry.id]: { lastRating: null } }),
    })).toBe(1)
  })

  it('skips a scored 重练 in favour of a later unscored card', () => {
    const retry = card('retry:round-1:a:1', 'a')
    expect(findEarliestUnscoredIndex({
      cards: [card('a'), retry, card('z')],
      completedIds: [],
      encounters: { a: enc(3), [retry.id]: enc(2) },
      roundPlan: null,
    })).toBe(2)
  })
})

describe('areAllOccurrencesPassed', () => {
  it('stays open while any occurrence is only weak', () => {
    expect(areAllOccurrencesPassed({
      cards: [card('a'), card('b')],
      completedIds: [],
      encounters: { a: enc(3), b: enc(2) },
      roundPlan: null,
    })).toBe(false)
  })

  it('closes when every non-excluded occurrence passed', () => {
    expect(areAllOccurrencesPassed({
      cards: [card('a'), card('b')],
      completedIds: ['b'],
      encounters: { a: enc(4) },
      roundPlan: null,
    })).toBe(true)
  })
})

describe('yellow boundary hint is never outstanding work', () => {
  const hint = {
    id: 'review_hint:formal_review',
    type: 'review_hint',
    content_type: 'review_hint',
    text: '下一张：正式复习',
  } as FreestyleCard

  it('seek skips the hint even though it is never scored', () => {
    const input = {
      cards: [card('a'), hint, card('b')],
      completedIds: ['a', 'b'],
      encounters: { a: enc(3), b: enc(4) },
      roundPlan: null,
    }
    expect(findEarliestUnscoredIndex(input)).toBeNull()
    expect(unscoredOccurrenceIds(input)).toEqual([])
  })

  it('seek still finds real unscored work behind the hint', () => {
    const input = {
      cards: [card('a'), hint, card('b')],
      completedIds: ['a'],
      encounters: { a: enc(3) },
      roundPlan: null,
    }
    expect(findEarliestUnscoredIndex(input)).toBe(2)
  })

  it('does not block round completion with its own family', () => {
    expect(areAllOccurrencesPassed({
      cards: [card('a'), hint],
      completedIds: ['a'],
      encounters: {},
      roundPlan: null,
    })).toBe(true)
  })
})

describe('rail fill == isScored (契约 5)', () => {
  it('keeps progress-rail solid and isOccurrenceScored identical on one fixture', async () => {
    const retry = card('retry:round-1:a:1', 'a')
    const cards = [card('a'), card('b'), retry, card('z')]
    const encounters = {
      a: enc(2),
      [retry.id]: enc(null),
      z: enc(4),
    } as Record<string, FreestyleUnitEncounterState>
    const roundPlan = plan({
      a: { lastRating: 2 },
      b: { lastRating: null },
      [retry.id]: { lastRating: null },
      z: { lastRating: 4 },
    })
    const completedIds = [] as string[]
    const input = { cards, completedIds, encounters, roundPlan }
    // Must exercise the real rail fill helpers, not a reimplemented condition.
    const { liveEncounterFillDone, visualPlanStatus } = await import(
      '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
    )
    for (const card of cards) {
      const scored = isOccurrenceScored(card.id, input)
      expect(liveEncounterFillDone(encounters[card.id], false)).toBe(scored)
      expect(visualPlanStatus(
        'pending',
        encounters[card.id],
        undefined,
        scored,
      ) === 'completed').toBe(scored)
    }
    expect(scoredOccurrenceIds(input).sort()).toEqual(['a', 'z'].sort())
    expect(unscoredOccurrenceIds(input).sort()).toEqual(['b', retry.id].sort())
  })
})
