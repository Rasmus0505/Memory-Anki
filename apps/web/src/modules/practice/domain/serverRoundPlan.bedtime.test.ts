import { describe, expect, it } from 'vitest'
import type {
  FreestyleCard,
  FreestyleRoundPlanPayload,
} from '@/shared/api/contracts'

import { cardsForServerPlan } from './serverRoundPlan'

function branch(id: string): FreestyleCard {
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

describe('睡前复习 plan hydrate', () => {
  it('carries 睡前复习 flags from the plan onto live and reconstructed cards', () => {
    const a = branch('a')
    const b = branch('b')
    const plan: FreestyleRoundPlanPayload = {
      original_cards: [
        {
          card_id: 'a',
          unit_id: 'a-unit',
          unit_revision: 1,
          kind: 'mindmap_branch',
          palace_id: 1,
          palace_title: 'Palace 1',
          label: 'A',
          bedtime: true,
        },
        {
          card_id: 'b',
          unit_id: 'b-unit',
          unit_revision: 1,
          kind: 'mindmap_branch',
          palace_id: 1,
          palace_title: 'Palace 1',
          label: 'B',
        },
      ],
      presented_ids: ['b', 'a'],
      current_card_id: 'b',
      current_index: 0,
      completed_ids: [],
      excluded_ids: [],
      occurrences: [],
      encounters: {},
    }

    const hydrated = cardsForServerPlan([a, b], plan, 'round-1')
    const bedtimeOf = (card: FreestyleCard | undefined) =>
      card?.type === 'mindmap_branch' ? card.bedtime : undefined
    expect(bedtimeOf(hydrated.find((card) => card.id === 'a'))).toBe(true)
    expect(bedtimeOf(hydrated.find((card) => card.id === 'b'))).toBe(false)

    // A bedtime card whose live payload was already dropped is rebuilt from the
    // snapshot, and must not lose its moon.
    const reconstructed = cardsForServerPlan([], plan, 'round-1')
    expect(bedtimeOf(reconstructed.find((card) => card.id === 'a'))).toBe(true)
    expect(bedtimeOf(reconstructed.find((card) => card.id === 'b'))).toBe(false)
  })
})
