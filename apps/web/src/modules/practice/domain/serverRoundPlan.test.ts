import { describe, expect, it } from 'vitest'
import type { FreestyleReviewUnitCard, FreestyleRoundPlanPayload } from '@/shared/api/contracts'

import { createRetryOccurrence } from './queueState'
import {
  applyServerRatingsToRoundPlan,
  cardsForServerPlan,
  mergeServerPlanIntoLocalEncounters,
  nextUnfinishedCardId,
  nextUnfinishedPlanCardId,
  planHasNewDueWork,
  planIsFullyHandled,
  resolveResumePreferCardId,
  retainLocalRoundLedger,
} from './serverRoundPlan'
import { createRoundPlan, updateRoundPlanCard } from './roundPlan'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from './feedConfig'

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

describe('server round plan hydrate', () => {
  it('inserts confirmed retry occurrences in presented order', () => {
    const source = branch('a')
    const cards = [source, branch('b'), branch('c')]
    const retry = createRetryOccurrence(source, 'round-1', 2, 3)
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', 'b', 'c', retry.id],
      current_card_id: 'b',
      current_index: 1,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: retry.id,
        source_card_id: 'a',
        source_unit_id: 'a-unit',
        retry_attempt: 2,
        rating: 1,
        insert_target_index: 4,
        status: 'inserted',
        encounter_id: '',
      }],
      encounters: {},
    }
    expect(cardsForServerPlan(cards, plan, 'round-1').map((card) => card.id))
      .toEqual(['a', 'b', 'c', retry.id])
  })

  it('does not put an excluded unit or its newer revision back into the live feed', () => {
    const rebound = { ...branch('review_unit:u1:r2'), unit_id: 'u1' }
    const other = branch('b')
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [{
        card_id: 'review_unit:u1:r1',
        unit_id: 'u1',
        unit_revision: 1,
        kind: 'mindmap_branch',
        palace_id: 1,
        palace_title: 'P',
        label: 'A',
      }],
      presented_ids: ['review_unit:u1:r1', 'b'],
      current_card_id: 'b',
      current_index: 1,
      completed_ids: [],
      excluded_ids: ['review_unit:u1:r1'],
      occurrences: [],
      encounters: {},
    }
    expect(cardsForServerPlan([rebound, other], plan, 'round-1').map((card) => card.id)).toEqual(['b'])
  })

  it('keeps a completed retry occurrence in presented order', () => {
    const source = branch('a')
    const retry = createRetryOccurrence(source, 'round-1', 1, 3)
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', 'b', retry.id, 'c'],
      current_card_id: retry.id,
      current_index: 2,
      completed_ids: ['a', retry.id],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: retry.id,
        source_card_id: 'a',
        source_unit_id: 'a-unit',
        retry_attempt: 1,
        rating: 3,
        insert_target_index: 2,
        status: 'completed',
        encounter_id: 'enc-retry',
      }],
      encounters: {},
    }
    expect(cardsForServerPlan([source, branch('b'), branch('c'), retry], plan, 'round-1').map((card) => card.id))
      .toEqual(['a', 'b', retry.id, 'c'])
  })

  it('skips a completed current card and selects the next unfinished id', () => {
    const cards = [branch('a'), branch('b'), branch('c')]
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', 'b', 'c'],
      current_card_id: 'a',
      current_index: 0,
      completed_ids: ['a'],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }
    expect(nextUnfinishedCardId(plan, cards)).toBe('b')
  })

  it('treats a newer unit revision as already finished in this round', () => {
    const cards = [
      { ...branch('review_unit:u1:r1'), unit_id: 'u1', unit_revision: 1 },
      { ...branch('review_unit:u2:r1'), unit_id: 'u2', unit_revision: 1 },
    ]
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'review_unit:u1:r2', unit_id: 'u1', unit_revision: 2, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'u1' },
        { card_id: 'review_unit:u2:r1', unit_id: 'u2', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'u2' },
      ],
      presented_ids: ['review_unit:u1:r2', 'review_unit:u2:r1'],
      current_card_id: 'review_unit:u1:r2',
      current_index: 0,
      completed_ids: ['review_unit:u1:r2'],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }
    expect(nextUnfinishedCardId(plan, cards)).toBe('review_unit:u2:r1')
    expect(cardsForServerPlan(cards, plan, 'round-1').map((card) => card.id)).toEqual([
      'review_unit:u1:r1',
      'review_unit:u2:r1',
    ])
  })

  it('reconstructs completed review units omitted from the live queue', () => {
    const remaining = branch('review_unit:u2:r1')
    remaining.unit_id = 'u2'
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'review_unit:u1:r1', unit_id: 'u1', unit_revision: 1, kind: 'mindmap_branch', palace_id: 4, palace_title: 'Palace 4', label: '已过单元' },
        { card_id: 'review_unit:u2:r1', unit_id: 'u2', unit_revision: 1, kind: 'mindmap_branch', palace_id: 4, palace_title: 'Palace 4', label: 'u2' },
      ],
      presented_ids: ['review_unit:u1:r1', 'review_unit:u2:r1'],
      current_card_id: 'review_unit:u2:r1',
      current_index: 1,
      completed_ids: ['review_unit:u1:r1'],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }
    const hydrated = cardsForServerPlan([remaining], plan, 'round-1')
    expect(hydrated.map((card) => card.id)).toEqual(['review_unit:u1:r1', 'review_unit:u2:r1'])
    expect(hydrated[0]).toMatchObject({
      type: 'mindmap_branch',
      unit_id: 'u1',
      palace_id: 4,
      palace_title: 'Palace 4',
    })
  })

  it('does not append leftover due onto a fully handled round', () => {
    const cards = [branch('a'), branch('b'), branch('c')]
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'a', unit_id: 'a-unit', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'a' },
        { card_id: 'b', unit_id: 'b-unit', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'b' },
      ],
      presented_ids: ['a', 'b'],
      current_card_id: 'b',
      current_index: 1,
      completed_ids: ['a', 'b'],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }
    const hydrated = cardsForServerPlan(cards, plan, 'round-1')
    expect(hydrated.map((card) => card.id)).toEqual(['a', 'b'])
    expect(planHasNewDueWork(plan, cards)).toBe(true)
    expect(nextUnfinishedCardId(plan, hydrated)).toBeNull()
    expect(planIsFullyHandled(plan)).toBe(true)
  })

  it('treats an unfinished plan as not fully handled even without live cards', () => {
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'a', unit_id: 'a-unit', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'a' },
        { card_id: 'b', unit_id: 'b-unit', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'b' },
      ],
      presented_ids: ['a', 'b'],
      current_card_id: 'a',
      current_index: 0,
      completed_ids: ['a'],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }
    // The feed helper needs live rows; an empty array must not be used as a
    // "fully handled" signal (that used to mint a new round on every F5).
    expect(nextUnfinishedCardId(plan, [])).toBeNull()
    expect(nextUnfinishedPlanCardId(plan)).toBe('b')
    expect(planIsFullyHandled(plan)).toBe(false)
  })

  it('prefers the local draft cursor on cold-start refresh when it is still in-feed', () => {
    const cards = [branch('a'), branch('b'), branch('c')]
    expect(resolveResumePreferCardId({
      silent: false,
      draftCardId: 'c',
      serverCurrentId: 'a',
      userCardId: null,
      nextCards: cards,
    })).toBe('c')
    expect(resolveResumePreferCardId({
      silent: true,
      draftCardId: 'c',
      serverCurrentId: 'a',
      userCardId: 'b',
      nextCards: cards,
    })).toBe('b')
  })

  it('fills missing local ratings from the server plan after refresh', () => {
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'a', unit_id: 'a-unit', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'a' },
        { card_id: 'b', unit_id: 'b-unit', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'b' },
      ],
      presented_ids: ['a', 'b'],
      current_card_id: 'b',
      current_index: 1,
      completed_ids: ['a'],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: 'retry:round-1:b-unit:1',
        source_card_id: 'b',
        source_unit_id: 'b-unit',
        retry_attempt: 1,
        rating: 2,
        insert_target_index: 2,
        status: 'inserted',
        encounter_id: 'enc-b',
      }],
      encounters: {
        a: { encounter_id: 'enc-a', status: 'passed', unit_revision: 1 },
        b: { encounter_id: 'enc-b', status: 'failed', unit_revision: 1 },
      },
    }
    const merged = mergeServerPlanIntoLocalEncounters({}, plan, 'round-1')
    expect(merged.a).toMatchObject({ selectedRating: null, passed: true, status: 'closed' })
    expect(merged.b).toMatchObject({ selectedRating: 2, passed: false, status: 'closed' })
    expect(merged['retry:round-1:b-unit:1']).toBeUndefined()
    // Local draft wins when it already has a rating.
    expect(mergeServerPlanIntoLocalEncounters({
      a: {
        encounterId: 'local-a',
        roundId: 'round-1',
        unitRevision: 1,
        status: 'closed',
        sessionId: null,
        selectedRating: 4,
        passed: true,
        retryAfterCards: 0,
      },
    }, plan, 'round-1').a.selectedRating).toBe(4)

    const hud = applyServerRatingsToRoundPlan(
      createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG, {
        candidate_count: 2,
        scheduled_count: 2,
        queue_limit: 20,
        limit_reached: false,
      }),
      plan,
    )
    expect(hud.cardsById.a.lastRating).toBeNull()
    expect(hud.cardsById.b.lastRating).toBe(2)
  })

  it('does not invent a rating for peer completion with no local encounter', () => {
    const server: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', 'b'],
      current_card_id: 'a',
      current_index: 0,
      completed_ids: ['a'],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }
    const merged = mergeServerPlanIntoLocalEncounters({}, server, 'round-secondary')
    expect(merged.a).toMatchObject({ selectedRating: null, passed: true, status: 'closed' })
    const local = createRoundPlan('round-secondary', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG)
    expect(applyServerRatingsToRoundPlan(local, server).cardsById.a.lastRating).toBeNull()
    expect(nextUnfinishedPlanCardId(server)).toBe('b')
  })

  it('does not prefill a retry card with the parent scheduling rating', () => {
    const source = branch('b')
    const retry = createRetryOccurrence(source, 'round-1', 1, 3, 'retry:round-1:b-unit:1')
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['b', retry.id],
      current_card_id: retry.id,
      current_index: 1,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: retry.id,
        source_card_id: 'b',
        source_unit_id: 'b-unit',
        retry_attempt: 1,
        rating: 2,
        insert_target_index: 1,
        status: 'inserted',
        encounter_id: 'enc-b',
      }],
      encounters: {
        b: { encounter_id: 'enc-b', status: 'failed', unit_revision: 1 },
      },
    }
    const local = createRoundPlan('round-1', [source, retry], DEFAULT_FREESTYLE_FEED_CONFIG)
    const inherited = applyServerRatingsToRoundPlan(
      {
        ...local,
        cardsById: {
          ...local.cardsById,
          [retry.id]: { ...local.cardsById[retry.id], lastRating: 2 },
        },
      },
      plan,
    )
    expect(inherited.cardsById.b.lastRating).toBe(2)
    expect(inherited.cardsById[retry.id].lastRating).toBeNull()
    expect(mergeServerPlanIntoLocalEncounters({
      [retry.id]: {
        encounterId: 'enc-b',
        roundId: 'round-1',
        unitRevision: 1,
        status: 'closed',
        sessionId: null,
        selectedRating: 2,
        passed: false,
        retryAfterCards: 3,
      },
    }, plan, 'round-1')[retry.id]).toMatchObject({
      selectedRating: null,
      status: 'pending',
    })

    const ratedPlan: FreestyleRoundPlanPayload = {
      ...plan,
      occurrences: [{ ...plan.occurrences![0], rating: 3, encounter_id: 'enc-retry' }],
      encounters: {
        b: { encounter_id: 'enc-b', status: 'failed', unit_revision: 1 },
        [retry.id]: { encounter_id: 'enc-retry', status: 'passed', unit_revision: 1 },
      },
    }
    const owned = applyServerRatingsToRoundPlan(local, ratedPlan)
    expect(owned.cardsById[retry.id].lastRating).toBe(3)
    // Occurrence-local: a scored 重练 glance must not stamp the source id.
    // A source fail summary has no concrete score; never borrow the retry's 3.
    expect(owned.cardsById.b.lastRating).toBeNull()
    const merged = mergeServerPlanIntoLocalEncounters({}, ratedPlan, 'round-1')
    expect(merged[retry.id]?.selectedRating).toBe(3)
    expect(merged.b?.selectedRating ?? null).not.toBe(3)
    expect(mergeServerPlanIntoLocalEncounters({}, ratedPlan, 'round-1')[retry.id]).toMatchObject({
      selectedRating: 3,
      passed: true,
    })
  })

  it('keeps an optimistic last-card retry while the server occurrence is still pending', () => {
    const earlier = [branch('c1'), branch('c2'), branch('c3'), branch('c4')]
    const source = branch('source')
    const localRetry = createRetryOccurrence(source, 'round-1', 1, 0)
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [...earlier, source].map((card) => ({
        card_id: card.id,
        unit_id: card.unit_id,
        unit_revision: 1,
        kind: 'mindmap_branch',
        palace_id: 1,
        palace_title: 'Palace 1',
        label: card.id,
        entered_on: '2026-09-22',
      })),
      presented_ids: ['c1', 'c2', 'c3', 'c4', 'source'],
      current_card_id: 'source',
      current_index: 4,
      completed_ids: ['c1', 'c2', 'c3', 'c4'],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: 'retry:round-1:source-unit:1',
        source_card_id: 'source',
        source_unit_id: 'source-unit',
        retry_attempt: 1,
        rating: 2,
        insert_target_index: 5,
        status: 'pending',
        encounter_id: 'enc-hard',
      }],
      encounters: {},
    }
    expect(planIsFullyHandled(plan)).toBe(false)
    expect(nextUnfinishedPlanCardId(plan)).toBe('source')
    const hydrated = cardsForServerPlan([...earlier, source, localRetry], plan, 'round-1')
    expect(hydrated.map((card) => card.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'source', localRetry.id])
  })

  it('keeps a pending optimistic retry in its local gap instead of the tail', () => {
    const source = branch('a')
    const localRetry = createRetryOccurrence(source, 'round-1', 1, 2)
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', 'b', 'c', 'd'],
      current_card_id: 'a',
      current_index: 0,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: 'retry:round-1:a-unit:1',
        source_card_id: 'a',
        source_unit_id: 'a-unit',
        retry_attempt: 1,
        rating: 1,
        insert_target_index: 3,
        status: 'pending',
        encounter_id: 'enc-forget',
      }],
      encounters: {},
    }
    const hydrated = cardsForServerPlan(
      [source, branch('b'), branch('c'), localRetry, branch('d')],
      plan,
      'round-1',
    )
    expect(hydrated.map((card) => card.id)).toEqual(['a', 'b', 'c', localRetry.id, 'd'])
  })

  it('uses the server occurrence id and does not append extra local retries', () => {
    const source = branch('review_unit:u1:r1')
    source.unit_id = 'u1'
    const localRetry = createRetryOccurrence(source, 'round-1', 1, 3)
    const serverOccId = 'retry:round-1:u1:1'
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'review_unit:u1:r1', unit_id: 'u1', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'u1' },
        { card_id: 'review_unit:u2:r1', unit_id: 'u2', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'u2' },
      ],
      presented_ids: ['review_unit:u1:r1', 'review_unit:u2:r1', serverOccId],
      current_card_id: 'review_unit:u2:r1',
      current_index: 1,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: serverOccId,
        source_card_id: 'review_unit:u1:r1',
        source_unit_id: 'u1',
        retry_attempt: 1,
        rating: 2,
        insert_target_index: 2,
        status: 'inserted',
        encounter_id: '',
      }],
      encounters: {},
    }
    const hydrated = cardsForServerPlan(
      [source, branch('review_unit:u2:r1'), localRetry],
      plan,
      'round-1',
    )
    expect(hydrated.map((card) => card.id)).toEqual([
      'review_unit:u1:r1',
      'review_unit:u2:r1',
      serverOccId,
    ])
    expect(hydrated.filter((card) => card.occurrence_kind === 'retry')).toHaveLength(1)
  })

  it('keeps the local retry id when the server occurrence id differs', () => {
    const source = branch('review_unit:u1:r1')
    source.unit_id = 'u1'
    const localRetry = createRetryOccurrence(source, 'round-1', 1, 0, 'retry:local-open')
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        { card_id: 'review_unit:u1:r1', unit_id: 'u1', unit_revision: 1, kind: 'mindmap_branch', palace_id: 1, palace_title: 'Palace 1', label: 'u1' },
      ],
      presented_ids: ['review_unit:u1:r1', 'retry:round-1:u1:1'],
      current_card_id: 'retry:local-open',
      current_index: 1,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: 'retry:round-1:u1:1',
        source_card_id: 'review_unit:u1:r1',
        source_unit_id: 'u1',
        retry_attempt: 1,
        rating: 2,
        insert_target_index: 1,
        status: 'inserted',
        encounter_id: '',
      }],
      encounters: {},
    }
    const hydrated = cardsForServerPlan([source, localRetry], plan, 'round-1')
    expect(hydrated.map((card) => card.id)).toEqual(['review_unit:u1:r1', 'retry:local-open'])
  })
})

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

describe('retainLocalRoundLedger', () => {
  it('keeps this-round scores when a stale hydrate clears completed ids', () => {
    const localPlan = createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const scored = updateRoundPlanCard(
      updateRoundPlanCard(localPlan, 'a', { status: 'completed', lastRating: 4 }),
      'b',
      { status: 'retry', lastRating: 1 },
    )
    const hydrated = createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const retained = retainLocalRoundLedger({
      localPlan: scored,
      localCompletedIds: ['a'],
      localEncounters: { a: encounter('a', 4), b: encounter('b', 1) },
      hydratedPlan: hydrated,
      hydratedCompletedIds: [],
      hydratedEncounters: { a: encounter('a', null), b: encounter('b', null) },
    })
    expect(retained.plan.cardsById.a).toMatchObject({ status: 'completed', lastRating: 4 })
    expect(retained.plan.cardsById.b).toMatchObject({ status: 'retry', lastRating: 1 })
    expect(retained.completedIds).toEqual(['a'])
    expect(retained.encounters.a?.selectedRating).toBe(4)
    expect(retained.encounters.b?.selectedRating).toBe(1)
  })

  it('puts a dropped queue removal back on the plan', () => {
    const localPlan = updateRoundPlanCard(
      createRoundPlan('round-1', [branch('a'), branch('gone'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG),
      'gone',
      { status: 'excluded' },
    )
    const hydrated = createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const retained = retainLocalRoundLedger({
      localPlan,
      localCompletedIds: [],
      localEncounters: {},
      hydratedPlan: hydrated,
      hydratedCompletedIds: [],
      hydratedEncounters: {},
    })
    expect(retained.plan.orderIds).toEqual(['a', 'gone', 'b'])
    expect(retained.plan.cardsById.gone?.status).toBe('excluded')
  })

  it('does not resurrect a cancelled rating', () => {
    const localPlan = updateRoundPlanCard(
      createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG),
      'a',
      { status: 'pending', lastRating: null },
    )
    const hydrated = updateRoundPlanCard(
      createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG),
      'a',
      { status: 'pending', lastRating: null },
    )
    const retained = retainLocalRoundLedger({
      localPlan,
      localCompletedIds: ['a'],
      localEncounters: { a: encounter('a', null) },
      hydratedPlan: hydrated,
      hydratedCompletedIds: [],
      hydratedEncounters: { a: encounter('a', null) },
    })
    expect(retained.plan.cardsById.a).toMatchObject({ status: 'pending', lastRating: null })
    expect(retained.completedIds).toEqual([])
    expect(retained.encounters.a?.selectedRating).toBeNull()
  })

  it('rebinds a source score onto the new revision and leaves the retry blank', () => {
    const previous = createRoundPlan(
      'round-1',
      [branch('review_unit:u1:r1')],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    const localPlan = updateRoundPlanCard(previous, 'review_unit:u1:r1', {
      status: 'completed',
      lastRating: 3,
    })
    const retry = createRetryOccurrence(branch('review_unit:u1:r2'), 'round-1', 1, 3)
    const hydrated = createRoundPlan(
      'round-1',
      [branch('review_unit:u1:r2'), retry],
      DEFAULT_FREESTYLE_FEED_CONFIG,
    )
    const retained = retainLocalRoundLedger({
      localPlan,
      localCompletedIds: ['review_unit:u1:r1'],
      localEncounters: { 'review_unit:u1:r1': encounter('review_unit:u1:r1', 3) },
      hydratedPlan: hydrated,
      hydratedCompletedIds: [],
      hydratedEncounters: {},
    })
    expect(retained.plan.cardsById['review_unit:u1:r2']).toMatchObject({ status: 'completed', lastRating: 3 })
    expect(retained.plan.cardsById[retry.id]?.lastRating ?? null).toBeNull()
    expect(retained.completedIds).toEqual(['review_unit:u1:r2'])
    expect(retained.encounters['review_unit:u1:r2']?.selectedRating).toBe(3)
    expect(retained.encounters[retry.id]).toBeUndefined()
  })
})
