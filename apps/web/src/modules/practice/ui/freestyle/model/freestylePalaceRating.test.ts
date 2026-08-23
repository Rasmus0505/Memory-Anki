import { describe, expect, it } from 'vitest'
import type { FreestyleReviewUnitCard } from '@/shared/api/contracts'
import {
  buildPalaceRatingTarget,
  palaceRatingEffectLine,
  palaceRatingPreviewLabel,
} from './freestylePalaceRating'

function unitCard(
  overrides: Partial<FreestyleReviewUnitCard> & Pick<FreestyleReviewUnitCard, 'id' | 'unit_id'>,
): FreestyleReviewUnitCard {
  return {
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 7,
    palace_title: '测试宫殿',
    anchor_uid: overrides.unit_id,
    context_path: [],
    node_uids: [overrides.unit_id],
    node_count: 1,
    phase: 'due',
    unit_revision: 1,
    ...overrides,
  }
}

describe('buildPalaceRatingTarget', () => {
  const current = unitCard({ id: 'card-a', unit_id: 'unit-a' })
  const sibling = unitCard({ id: 'card-b', unit_id: 'unit-b' })
  const fill = unitCard({ id: 'card-fill', unit_id: 'unit-fill', phase: 'fill' })
  const otherPalace = unitCard({ id: 'card-x', unit_id: 'unit-x', palace_id: 9 })

  it('counts unrated due siblings plus leftover due', () => {
    const target = buildPalaceRatingTarget({
      current,
      cards: [current, sibling, otherPalace],
      leftoverDue: 2,
    })
    expect(target.dueCount).toBe(4)
    expect(target.excludeUnitIds).toEqual([])
    expect(target.includeUnitIds.sort()).toEqual(['unit-a', 'unit-b'])
    expect(target.settleCards.map((item) => item.unitId).sort()).toEqual(['unit-a', 'unit-b'])
  })

  it('excludes units already rated this round and does not overwrite them', () => {
    const target = buildPalaceRatingTarget({
      current,
      cards: [current, sibling],
      leftoverDue: 0,
      completedIds: ['card-b'],
    })
    expect(target.excludeUnitIds).toEqual(['unit-b'])
    expect(target.dueCount).toBe(1)
    expect(target.includeUnitIds).toEqual(['unit-a'])
    expect(target.settleCards).toEqual([{ cardId: 'card-a', unitId: 'unit-a' }])
  })

  it('includes unrated fill siblings so the next palace card is not left to rate', () => {
    const otherFill = unitCard({ id: 'card-fill-2', unit_id: 'unit-fill-2', phase: 'fill' })
    const target = buildPalaceRatingTarget({
      current: fill,
      cards: [fill, sibling, otherFill],
      leftoverDue: 1,
    })
    expect(target.dueCount).toBe(4)
    expect(target.includeUnitIds.sort()).toEqual(['unit-b', 'unit-fill', 'unit-fill-2'])
    expect(target.settleCards.map((item) => item.cardId).sort()).toEqual([
      'card-b',
      'card-fill',
      'card-fill-2',
    ])
  })

  it('treats an encounter rating as already handled', () => {
    const target = buildPalaceRatingTarget({
      current,
      cards: [current, sibling],
      leftoverDue: 0,
      encountersByCardId: {
        'card-b': {
          encounterId: 'enc-b',
          unitRevision: 1,
          status: 'open',
          sessionId: 's',
          selectedRating: 1,
          passed: false,
          retryAfterCards: 3,
        },
      },
    })
    expect(target.excludeUnitIds).toEqual(['unit-b'])
    expect(target.dueCount).toBe(1)
  })
})

describe('palace rating copy', () => {
  it('prints a count instead of a single-unit interval', () => {
    expect(palaceRatingPreviewLabel(5, 'pass')).toBe('5小节')
    expect(palaceRatingPreviewLabel(5, 'fail')).toBe('5小节重练')
    expect(palaceRatingPreviewLabel(5, 'locked')).toBe('5小节不改期')
    expect(palaceRatingEffectLine('记得', 5)).toBe('已选记得 · 今日 5 个到期小节，各自按阶梯改期')
  })
})
