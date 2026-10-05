import { describe, expect, it } from 'vitest'
import type { FreestyleRoundPlanPayload } from '@/shared/api/contracts'

import { DEFAULT_FREESTYLE_FEED_CONFIG } from './feedConfig'
import { coalesceHydrationLedger, commitHydratedRoundLedger } from './hydrateRoundLedger'
import { createRoundPlan, updateRoundPlanCard } from './roundPlan'
import { findEarliestUnscoredIndex } from './unitProgressState'
import type { FreestyleReviewUnitCard } from '@/shared/api/contracts'

function branch(id: string, palaceId = 1): FreestyleReviewUnitCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: `Palace ${palaceId}`,
    anchor_uid: id,
    context_path: [],
    node_uids: [id],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  }
}

function encounter(cardId: string, selectedRating: 1 | 2 | 3 | 4 | null) {
  return {
    encounterId: `enc-${cardId}`,
    roundId: 'round-1',
    unitRevision: 1,
    status: selectedRating == null ? 'pending' as const : 'closed' as const,
    sessionId: null,
    selectedRating,
    passed: selectedRating == null ? null : selectedRating >= 3,
    retryAfterCards: 0,
  }
}

function serverPlan(patch: Partial<FreestyleRoundPlanPayload>): FreestyleRoundPlanPayload {
  return {
    original_cards: [],
    presented_ids: [],
    current_card_id: null,
    current_index: 0,
    completed_ids: [],
    excluded_ids: [],
    occurrences: [],
    encounters: {},
    ...patch,
  }
}

describe('coalesceHydrationLedger', () => {
  it('keeps a removal and this-round scores when the live ledger was wiped onto another round', () => {
    const removed = 'review_unit:u1:r1'
    let capturedPlan = createRoundPlan(
      'local-round',
      [branch('a'), branch(removed), branch('b')],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    capturedPlan = updateRoundPlanCard(capturedPlan, 'a', { status: 'completed', lastRating: 4 })
    capturedPlan = updateRoundPlanCard(capturedPlan, 'b', { status: 'retry', lastRating: 1 })
    capturedPlan = updateRoundPlanCard(capturedPlan, removed, { status: 'excluded' })
    const wiped = createRoundPlan(
      'freestyle-round-server',
      [branch('a'), branch(removed), branch('b')],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    const result = coalesceHydrationLedger(
      {
        plan: capturedPlan,
        completedIds: ['a'],
        hiddenIds: [removed],
        encounters: { a: encounter('a', 4), b: encounter('b', 1) },
      },
      {
        plan: wiped,
        completedIds: [],
        hiddenIds: [],
        encounters: {},
      },
    )
    expect(result.plan?.cardsById.a).toMatchObject({ status: 'completed', lastRating: 4 })
    expect(result.plan?.cardsById.b).toMatchObject({ status: 'retry', lastRating: 1 })
    expect(result.plan?.cardsById[removed]?.status).toBe('excluded')
    expect(result.hiddenIds).toContain(removed)
    expect(result.completedIds).toContain('a')
    expect(result.encounters.a?.selectedRating).toBe(4)
  })

  it('puts a removal back when a stale snapshot still has the other scores', () => {
    const removed = 'review_unit:u1:r1'
    let capturedPlan = createRoundPlan(
      'round-1',
      [branch('a'), branch(removed)],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    capturedPlan = updateRoundPlanCard(capturedPlan, 'a', { status: 'completed', lastRating: 3 })
    capturedPlan = updateRoundPlanCard(capturedPlan, removed, { status: 'excluded' })
    const stale = updateRoundPlanCard(
      createRoundPlan('round-1', [branch('a'), branch(removed)], DEFAULT_FREESTYLE_FEED_CONFIG),
      'a',
      { status: 'completed', lastRating: 3 },
    )
    const result = coalesceHydrationLedger(
      {
        plan: capturedPlan,
        completedIds: ['a'],
        hiddenIds: [removed],
        encounters: { a: encounter('a', 3) },
      },
      {
        plan: stale,
        completedIds: ['a'],
        hiddenIds: [],
        encounters: { a: encounter('a', 3) },
      },
    )
    expect(result.plan?.cardsById.a).toMatchObject({ status: 'completed', lastRating: 3 })
    expect(result.plan?.cardsById[removed]?.status).toBe('excluded')
    expect(result.hiddenIds).toContain(removed)
  })

  it('does not put back a removal the learner already restored', () => {
    const removed = 'review_unit:u1:r1'
    let capturedPlan = createRoundPlan(
      'round-1',
      [branch(removed)],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    capturedPlan = updateRoundPlanCard(capturedPlan, removed, { status: 'excluded' })
    const restored = updateRoundPlanCard(capturedPlan, removed, { status: 'pending' })
    const result = coalesceHydrationLedger(
      {
        plan: capturedPlan,
        completedIds: [],
        hiddenIds: [removed],
        encounters: {},
      },
      {
        plan: restored,
        completedIds: [],
        hiddenIds: [],
        encounters: {},
      },
      [removed],
    )
    expect(result.plan?.cardsById[removed]?.status).toBe('pending')
    expect(result.hiddenIds).not.toContain(removed)
  })
})

describe('commitHydratedRoundLedger', () => {
  it('keeps scores and a queue removal when the adopted round id would wipe a draft plan', () => {
    const removed = 'review_unit:u1:r1'
    const rebound = 'review_unit:u1:r2'
    let localPlan = createRoundPlan(
      'round-1',
      [branch('a'), branch(removed), branch('b')],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    localPlan = updateRoundPlanCard(localPlan, 'a', { status: 'completed', lastRating: 4 })
    localPlan = updateRoundPlanCard(localPlan, 'b', { status: 'retry', lastRating: 1 })
    localPlan = updateRoundPlanCard(localPlan, removed, { status: 'excluded' })
    const cards = [branch('a'), branch(rebound), branch('b'), branch('c')]
    const result = commitHydratedRoundLedger({
      localPlan,
      localCompletedIds: ['a'],
      localHiddenIds: [removed],
      localEncounters: { a: encounter('a', 4), b: encounter('b', 1) },
      adoptedRoundId: 'round-2',
      cards,
      config: DEFAULT_FREESTYLE_FEED_CONFIG,
      meta: { candidate_count: 4, scheduled_count: 4, queue_limit: 20, limit_reached: false },
      serverPlan: serverPlan({
        presented_ids: ['a', rebound, 'b', 'c'],
        current_card_id: 'c',
        completed_ids: [],
        excluded_ids: [],
      }),
    })
    expect(result.plan.cardsById.a).toMatchObject({ status: 'completed', lastRating: 4 })
    expect(result.plan.cardsById.b).toMatchObject({ status: 'retry', lastRating: 1 })
    expect(result.completedIds).toContain('a')
    expect(result.plan.cardsById[rebound]?.status).toBe('excluded')
    expect(result.hiddenIds).toEqual(expect.arrayContaining([removed, rebound]))
    const visible = cards.filter((card) => !result.hiddenIds.includes(card.id))
    expect(findEarliestUnscoredIndex({
      cards: visible,
      completedIds: result.completedIds,
      encounters: result.encounters,
      roundPlan: result.plan,
    })).toBe(visible.findIndex((card) => card.id === 'c'))
  })

  it('still drops a cancelled rating when the local plan already cleared it', () => {
    const localPlan = updateRoundPlanCard(
      createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG),
      'a',
      { status: 'pending', lastRating: null },
    )
    const result = commitHydratedRoundLedger({
      localPlan,
      localCompletedIds: ['a'],
      localHiddenIds: [],
      localEncounters: { a: encounter('a', null) },
      adoptedRoundId: 'round-1',
      cards: [branch('a'), branch('b')],
      config: DEFAULT_FREESTYLE_FEED_CONFIG,
      meta: { candidate_count: 2, scheduled_count: 2, queue_limit: 20, limit_reached: false },
      serverPlan: serverPlan({ presented_ids: ['a', 'b'], completed_ids: [] }),
    })
    expect(result.plan.cardsById.a).toMatchObject({ status: 'pending', lastRating: null })
    expect(result.completedIds).toEqual([])
    expect(result.encounters.a?.selectedRating ?? null).toBeNull()
  })

  it('stamps a just-confirmed removal even when the local plan never had it', () => {
    const removed = 'review_unit:u1:r1'
    const cards = [branch('a'), branch(removed), branch('b')]
    const localPlan = updateRoundPlanCard(
      createRoundPlan('round-1', cards, DEFAULT_FREESTYLE_FEED_CONFIG),
      'a',
      { status: 'completed', lastRating: 4 },
    )
    const result = commitHydratedRoundLedger({
      localPlan,
      localCompletedIds: ['a'],
      localHiddenIds: [],
      localEncounters: { a: encounter('a', 4) },
      adoptedRoundId: 'freestyle-round-server',
      cards,
      config: DEFAULT_FREESTYLE_FEED_CONFIG,
      meta: { candidate_count: 3, scheduled_count: 3, queue_limit: 20, limit_reached: false },
      serverPlan: serverPlan({
        presented_ids: ['a', removed, 'b'],
        completed_ids: [],
        excluded_ids: [],
      }),
      forceExcludedIds: [removed],
    })
    expect(result.plan.cardsById.a).toMatchObject({ status: 'completed', lastRating: 4 })
    expect(result.plan.cardsById[removed]?.status).toBe('excluded')
    expect(result.hiddenIds).toContain(removed)
    const visible = cards.filter((card) => !result.hiddenIds.includes(card.id))
    expect(findEarliestUnscoredIndex({
      cards: visible,
      completedIds: result.completedIds,
      encounters: result.encounters,
      roundPlan: result.plan,
    })).toBe(visible.findIndex((card) => card.id === 'b'))
  })

  it('drops local-only scores when adopting the server ledger', () => {
    let localPlan = createRoundPlan(
      'round-1',
      [branch('a'), branch('b'), branch('c')],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    localPlan = updateRoundPlanCard(localPlan, 'a', { status: 'completed', lastRating: 4 })
    localPlan = updateRoundPlanCard(localPlan, 'b', { status: 'completed', lastRating: 3 })
    const cards = [branch('a'), branch('b'), branch('c'), branch('removed')]
    const result = commitHydratedRoundLedger({
      localPlan,
      localCompletedIds: ['a', 'b'],
      localHiddenIds: ['local-only'],
      localEncounters: { a: encounter('a', 4), b: encounter('b', 3) },
      adoptedRoundId: 'round-1',
      cards,
      config: DEFAULT_FREESTYLE_FEED_CONFIG,
      meta: { candidate_count: 4, scheduled_count: 4, queue_limit: 20, limit_reached: false },
      serverPlan: serverPlan({
        presented_ids: ['a', 'b', 'c', 'removed'],
        current_card_id: 'b',
        completed_ids: ['a'],
        excluded_ids: ['removed'],
        occurrences: [{
          occurrence_id: 'occ-a',
          source_card_id: 'a',
          source_unit_id: 'a-unit',
          retry_attempt: 0,
          rating: 2,
          insert_target_index: 0,
          status: 'completed',
          encounter_id: 'enc-a',
        }],
      }),
      adoptServerLedger: true,
    })
    expect(result.plan?.cardsById.a).toMatchObject({ status: 'completed', lastRating: 2 })
    expect(result.completedIds).toEqual(['a'])
    expect(result.encounters.a?.selectedRating).toBe(2)
    expect(result.plan?.cardsById.b).toMatchObject({ status: 'pending', lastRating: null })
    expect(result.encounters.b?.selectedRating ?? null).toBeNull()
    expect(result.completedIds).not.toContain('b')
    expect(result.hiddenIds).toContain('removed')
    expect(result.hiddenIds).not.toContain('local-only')
  })
})
