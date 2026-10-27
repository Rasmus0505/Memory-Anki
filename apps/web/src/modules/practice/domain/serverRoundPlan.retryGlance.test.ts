import { describe, expect, it } from 'vitest'
import type { FreestyleReviewUnitCard, FreestyleRoundPlanPayload } from '@/shared/api/contracts'

import { DEFAULT_FREESTYLE_FEED_CONFIG } from './feedConfig'
import { createRoundPlan, updateRoundPlanCard } from './roundPlan'
import { createRetryOccurrence } from './queueState'
import {
  applyServerRatingsToRoundPlan,
  mergeServerPlanIntoLocalEncounters,
  retryGlanceOwnsRating,
} from './serverRoundPlan'

function branch(id: string): FreestyleReviewUnitCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: 'Palace 1',
    anchor_uid: id,
    context_path: [],
    node_uids: [id],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  }
}

describe('retry glance ownership', () => {
  it('ignores a previous attempt encounter when the parent re-schedules the slot', () => {
    const source = branch('a')
    const retry = createRetryOccurrence(source, 'round-1', 1, 3, 'retry:round-1:a-unit:1')
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', retry.id],
      current_card_id: retry.id,
      current_index: 1,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: retry.id,
        source_card_id: 'a',
        source_unit_id: 'a-unit',
        retry_attempt: 2,
        rating: 2,
        insert_target_index: 1,
        status: 'inserted',
        // The parent's fresh 困难 scheduled this glance…
        encounter_id: 'enc-parent',
      }],
      encounters: {
        // …so the slot's stored entry still belongs to the earlier attempt.
        [retry.id]: { encounter_id: 'enc-old-retry', status: 'failed', unit_revision: 1, rating: 2 },
      },
    }
    expect(retryGlanceOwnsRating(plan, retry.id)).toBe(false)

    let local = createRoundPlan('round-1', [source, retry], DEFAULT_FREESTYLE_FEED_CONFIG)
    local = updateRoundPlanCard(local, retry.id, { lastRating: 2 })
    expect(applyServerRatingsToRoundPlan(local, plan).cardsById[retry.id].lastRating).toBeNull()
    const merged = mergeServerPlanIntoLocalEncounters({
      [retry.id]: {
        encounterId: 'enc-old-retry',
        roundId: 'round-1',
        unitRevision: 1,
        status: 'closed',
        sessionId: null,
        selectedRating: 2,
        passed: false,
        retryAfterCards: 3,
      },
    }, plan, 'round-1')
    expect(merged[retry.id]).toMatchObject({ selectedRating: null, status: 'pending' })
  })

  it('still owns a score when the stored encounter is this glance', () => {
    const source = branch('a')
    const retry = createRetryOccurrence(source, 'round-1', 1, 3, 'retry:round-1:a-unit:1')
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [],
      presented_ids: ['a', retry.id],
      current_card_id: retry.id,
      current_index: 1,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [{
        occurrence_id: retry.id,
        source_card_id: 'a',
        source_unit_id: 'a-unit',
        retry_attempt: 1,
        rating: 2,
        insert_target_index: 1,
        status: 'inserted',
        encounter_id: 'enc-retry',
      }],
      encounters: {
        [retry.id]: { encounter_id: 'enc-retry', status: 'failed', unit_revision: 1, rating: 2 },
      },
    }
    expect(retryGlanceOwnsRating(plan, retry.id)).toBe(true)
  })
})
