import { describe, expect, it } from 'vitest'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import { overlayQuizRangeLabel, overlayReviewPalaceIds } from './overlayQuizRange'

function planCard(
  cardId: string,
  palaceId: number,
  kind = 'mindmap_branch',
  occurrenceKind: 'source' | 'retry' = 'source',
): FreestyleRoundPlanState['cardsById'][string] {
  return {
    cardId,
    sourceCardId: cardId,
    occurrenceKind,
    retryAttempt: occurrenceKind === 'retry' ? 1 : 0,
    palaceId,
    palaceTitle: `宫殿 ${palaceId}`,
    label: cardId,
    kind,
    status: 'pending',
    lastRating: null,
    retryAfterCards: 0,
    attemptCount: 0,
    updatedAt: 0,
  }
}

describe('overlayQuizRange', () => {
  it('counts only review palaces already in this round', () => {
    const plan: FreestyleRoundPlanState = {
      roundId: 'round-1',
      configSignature: 'sig',
      createdAt: 0,
      candidateCount: 3,
      scheduledCount: 3,
      queueLimit: 20,
      limitReached: false,
      orderIds: ['a', 'b', 'q'],
      cardsById: {
        a: planCard('a', 10),
        b: planCard('b', 10),
        retry: planCard('retry', 99, 'mindmap_branch', 'retry'),
        q: planCard('q', 61, 'quiz_question'),
      },
    }
    expect(overlayReviewPalaceIds(plan)).toEqual([10])
    expect(overlayQuizRangeLabel(1)).toBe('本轮纳入复习的 1 个宫殿')
    expect(overlayQuizRangeLabel(0)).toBe('本轮还没有纳入复习的宫殿')
  })
})
