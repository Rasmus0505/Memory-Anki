import { describe, expect, it } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  createRetryOccurrence,
  rebindCompletedIdsByUnit,
  rebindUnitEncountersByUnitId,
  removeRetryOccurrencesForSource,
  shouldRenewFreestyleEncounter,
  type FreestyleUnitEncounterState,
} from './queueState'

function encounter(overrides: Partial<FreestyleUnitEncounterState> = {}): FreestyleUnitEncounterState {
  return {
    encounterId: 'enc-1',
    roundId: 'round-1',
    unitRevision: 3,
    status: 'open',
    sessionId: 'session-1',
    selectedRating: null,
    passed: null,
    retryAfterCards: 0,
    ...overrides,
  }
}

describe('shouldRenewFreestyleEncounter', () => {
  it('reopens after an unrated swipe-away so the card can be scored again', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: null, passed: null }),
      3,
      true,
    )).toBe(true)
  })

  it('reopens a failed closed card for restudy', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: 1, passed: false }),
      3,
      true,
    )).toBe(true)
  })

  it('reopens a passed closed card so the learner can score it again', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: 3, passed: true }),
      3,
      true,
    )).toBe(true)
  })

  it('does not reopen a passed card while read-only history is showing', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: 3, passed: true }),
      3,
      false,
    )).toBe(false)
  })
})

function sourceCard(id: string, unitId: string, revision = 1): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '宫殿',
    anchor_uid: unitId,
    context_path: [],
    node_uids: [unitId],
    node_count: 1,
    unit_id: unitId,
    unit_revision: revision,
  }
}

describe('rebindUnitEncountersByUnitId', () => {
  it('keeps a retry occurrence encounter instead of merging it onto the source', () => {
    const source = sourceCard('review_unit:u1:r1', 'u1', 1)
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const sourceGlance = encounter({ encounterId: 'enc-source', selectedRating: 1, passed: false })
    const retryGlance = encounter({ encounterId: 'enc-retry', selectedRating: 2, passed: false })
    const rebound = rebindUnitEncountersByUnitId(
      {
        [source.id]: sourceGlance,
        [retry.id]: retryGlance,
      },
      [source, retry],
      [source, retry],
    )
    expect(rebound[source.id]?.encounterId).toBe('enc-source')
    expect(rebound[retry.id]?.encounterId).toBe('enc-retry')
    expect(rebound[retry.id]?.selectedRating).toBe(2)
  })

  it('rebinds only the source card when its review-unit id changes', () => {
    const previous = sourceCard('review_unit:u1:r1', 'u1', 1)
    const next = sourceCard('review_unit:u1:r2', 'u1', 2)
    const retry = createRetryOccurrence(previous, 'round-1', 1, 3)
    const rebound = rebindUnitEncountersByUnitId(
      {
        [previous.id]: encounter({ encounterId: 'enc-source' }),
        [retry.id]: encounter({ encounterId: 'enc-retry' }),
      },
      [previous, retry],
      [next, retry],
    )
    expect(rebound[next.id]?.encounterId).toBe('enc-source')
    expect(rebound[previous.id]).toBeUndefined()
    expect(rebound[retry.id]?.encounterId).toBe('enc-retry')
  })

  it('drops a retry encounter only after that occurrence leaves the feed', () => {
    const source = sourceCard('review_unit:u1:r1', 'u1')
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const rebound = rebindUnitEncountersByUnitId(
      { [retry.id]: encounter({ encounterId: 'enc-retry' }) },
      [source, retry],
      [source],
    )
    expect(rebound[retry.id]).toBeUndefined()
  })
})

describe('rebindCompletedIdsByUnit', () => {
  it('keeps a completed retry occurrence id instead of rewriting it to the source', () => {
    const source = sourceCard('review_unit:u1:r1', 'u1', 1)
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const next = sourceCard('review_unit:u1:r2', 'u1', 2)
    expect(
      rebindCompletedIdsByUnit([source.id, retry.id], [source, retry], [next, retry]),
    ).toEqual([next.id, retry.id])
  })
})

describe('removeRetryOccurrencesForSource', () => {
  it('keeps the just-rated retry card in the viewport', () => {
    const source = sourceCard('a', 'unit-a')
    const first = createRetryOccurrence(source, 'round-1', 1, 3)
    const second = createRetryOccurrence(source, 'round-1', 2, 3)
    const cards = [source, first, second]
    expect(removeRetryOccurrencesForSource(cards, 'a').map((card) => card.id)).toEqual(['a'])
    expect(removeRetryOccurrencesForSource(cards, 'a', first.id).map((card) => card.id)).toEqual([
      'a',
      first.id,
    ])
  })
})
