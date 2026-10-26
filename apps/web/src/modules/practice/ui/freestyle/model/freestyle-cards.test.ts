import { describe, expect, it } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import { freestyleFeedCardKey } from './freestyle-cards'

function card(patch: Record<string, unknown>): FreestyleCard {
  return {
    id: 'review_unit:unit-a:r1',
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '宫殿',
    unit_id: 'unit-a',
    unit_revision: 1,
    ...patch,
  } as unknown as FreestyleCard
}

describe('freestyleFeedCardKey', () => {
  it('keeps the same row identity when a content edit bumps the revision', () => {
    expect(freestyleFeedCardKey(card({}))).toBe('unit:unit-a')
    expect(freestyleFeedCardKey(card({ id: 'review_unit:unit-a:r4', unit_revision: 4 }))).toBe(
      'unit:unit-a',
    )
  })

  it('keeps a retry occurrence as its own row', () => {
    expect(
      freestyleFeedCardKey(card({
        id: 'retry:round-1:abc',
        occurrence_kind: 'retry',
        source_card_id: 'review_unit:unit-a:r1',
      })),
    ).toBe('retry:round-1:abc')
  })

  it('falls back to the card id for work that is not a unit glance', () => {
    expect(freestyleFeedCardKey(card({ type: 'quiz_question', unit_id: undefined }))).toBe(
      'review_unit:unit-a:r1',
    )
  })
})
