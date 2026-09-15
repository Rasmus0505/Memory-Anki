import { describe, expect, it } from 'vitest'
import type { FreestyleReviewUnitCard, FreestyleRoundPlanPayload } from '@/shared/api/contracts'

import { createRetryOccurrence } from './queueState'
import { cardsForServerPlan, nextUnfinishedCardId } from './serverRoundPlan'

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
})
