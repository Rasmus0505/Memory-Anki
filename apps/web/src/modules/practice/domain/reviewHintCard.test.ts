import { describe, expect, it } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  insertReviewHintCards,
  stripReviewHintCards,
} from './reviewHintCard'

function review(id: string): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  } as FreestyleCard
}

/** Path card: mindmap branch without unit identity (never a review unit). */
function path(id: string): FreestyleCard {
  return {
    id,
    type: 'anki_card',
    content_type: 'anki_card',
    presentation: 'anki',
    palace_id: 1,
  } as FreestyleCard
}

const HINT_ID = 'review_hint:formal_review'

describe('insertReviewHintCards', () => {
  it('inserts one hint immediately before the first formal review unit', () => {
    const next = insertReviewHintCards([path('a'), path('b'), review('c1'), review('c2')])
    expect(next.map((card) => card.id)).toEqual(['a', 'b', HINT_ID, 'c1', 'c2'])
    expect(next[2]).toMatchObject({ type: 'review_hint', text: '下一张：正式复习' })
  })

  it('does not insert when the first card is already a formal review unit', () => {
    const cards = [review('c1'), review('c2')]
    expect(insertReviewHintCards(cards)).toEqual(cards)
  })

  it('does not insert when the queue has no formal review unit', () => {
    const cards = [path('a'), path('b')]
    expect(insertReviewHintCards(cards)).toEqual(cards)
  })

  it('inserts only once even after later path → review boundaries', () => {
    const next = insertReviewHintCards([
      path('a'), review('c1'), review('c2'), path('d'), review('f1'),
    ])
    expect(next.filter((card) => card.type === 'review_hint')).toHaveLength(1)
    expect(next.map((card) => card.id)).toEqual(['a', HINT_ID, 'c1', 'c2', 'd', 'f1'])
  })

  it('is idempotent: re-running strips the old copy and reseats one hint', () => {
    const once = insertReviewHintCards([path('a'), review('c1')])
    const twice = insertReviewHintCards(once)
    expect(twice).toEqual(once)
    expect(twice.filter((card) => card.type === 'review_hint')).toHaveLength(1)
  })

  it('re-seats a hint that drifted away from the first review unit', () => {
    const drifted = [path('a'), review('c1'), {
      id: HINT_ID,
      type: 'review_hint',
      content_type: 'review_hint',
      text: '下一张：正式复习',
    } satisfies FreestyleCard]
    const next = insertReviewHintCards(drifted)
    expect(next.map((card) => card.id)).toEqual(['a', HINT_ID, 'c1'])
  })
})

describe('stripReviewHintCards', () => {
  it('removes only the hint and keeps everything else', () => {
    const cards = [path('a'), { id: HINT_ID, type: 'review_hint', content_type: 'review_hint', text: 'x' } as FreestyleCard, review('c1')]
    expect(stripReviewHintCards(cards).map((card) => card.id)).toEqual(['a', 'c1'])
  })
})
