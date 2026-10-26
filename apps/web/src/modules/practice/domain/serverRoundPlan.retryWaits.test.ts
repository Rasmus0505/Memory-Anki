import { describe, expect, it } from 'vitest'
import type { FreestyleRoundPlanPayload, FreestyleReviewUnitCard } from '@/shared/api/contracts'

import { applyServerRetryWaits } from './serverRoundPlan'
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

describe('server retry waits', () => {
  function planWithWait(): FreestyleRoundPlanPayload {
    return {
      original_cards: [],
      presented_ids: ['a', 'b'],
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
        insert_target_index: 1,
        status: 'pending',
        encounter_id: 'enc-forget',
        available_at: '2026-10-25T12:10:00+00:00',
      }],
      encounters: {},
    }
  }

  it('paints the pending instant onto the source row', () => {
    const plan = createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const stamped = applyServerRetryWaits(plan, planWithWait())
    expect(stamped.cardsById.a.retryAvailableAt).toBe('2026-10-25T12:10:00+00:00')
  })

  it('clears the wait once the retry is on the rail or answered', () => {
    const plan = createRoundPlan('round-1', [branch('a'), branch('b')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const seeded = updateRoundPlanCard(plan, 'a', {
      status: 'retry',
      retryAvailableAt: '2026-10-25T12:10:00+00:00',
    })
    const payload = planWithWait()
    payload.occurrences[0].status = 'inserted'
    const cleared = applyServerRetryWaits(seeded, payload)
    expect(cleared.cardsById.a.retryAvailableAt).toBeUndefined()
    expect(cleared.cardsById.a.status).toBe('retry')
  })

  it('lets a newer pending attempt win over an answered one', () => {
    const plan = createRoundPlan('round-1', [branch('a')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const seeded = updateRoundPlanCard(plan, 'a', {
      status: 'retry',
      retryAvailableAt: '2026-10-25T11:10:00+00:00',
    })
    const payload = planWithWait()
    payload.occurrences = [
      { ...payload.occurrences[0], occurrence_id: 'retry:round-1:a-unit:1', status: 'completed', rating: 1 },
      { ...payload.occurrences[0], occurrence_id: 'retry:round-1:a-unit:2', retry_attempt: 2, available_at: '2026-10-25T13:10:00+00:00' },
    ]
    const stamped = applyServerRetryWaits(seeded, payload)
    expect(stamped.cardsById.a.retryAvailableAt).toBe('2026-10-25T13:10:00+00:00')
  })

  it('leaves a local wait alone when the payload lists no occurrence for it', () => {
    const plan = createRoundPlan('round-1', [branch('a')], DEFAULT_FREESTYLE_FEED_CONFIG)
    const seeded = updateRoundPlanCard(plan, 'a', {
      status: 'retry',
      retryAvailableAt: '2026-10-25T12:10:00+00:00',
    })
    const payload = planWithWait()
    payload.occurrences = []
    expect(applyServerRetryWaits(seeded, payload).cardsById.a.retryAvailableAt)
      .toBe('2026-10-25T12:10:00+00:00')
  })
})
