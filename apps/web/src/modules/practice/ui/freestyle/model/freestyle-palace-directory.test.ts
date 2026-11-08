import { describe, expect, it } from 'vitest'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  completedSourceCardIdsForPalace,
  findPalaceJumpTarget,
  palaceHasPlanCards,
  resolvePalaceDirectoryClick,
  roundPalaceStatuses,
} from './freestyle-palace-directory'

function card(id: string, palaceId: number): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: `P${palaceId}`,
    unit_id: `unit-${id}`,
    unit_revision: 1,
    label: id,
  } as unknown as FreestyleCard
}

describe('palace directory click resolution', () => {
  it('ignores the palace already on screen', () => {
    expect(resolvePalaceDirectoryClick({
      palaceId: 7,
      currentPalaceId: 7,
      reviewPalaceId: null,
    })).toEqual({ kind: 'ignore' })
  })

  it('stays inside the palace review route', () => {
    expect(resolvePalaceDirectoryClick({
      palaceId: 9,
      currentPalaceId: 7,
      reviewPalaceId: 7,
    })).toEqual({ kind: 'review', palaceId: 9 })
  })

  it('inspects the live round instead of rewriting its scope', () => {
    expect(resolvePalaceDirectoryClick({
      palaceId: 9,
      currentPalaceId: 7,
      reviewPalaceId: null,
    })).toEqual({ kind: 'inspect' })
  })
})

describe('palace jump target', () => {
  const cards = [card('a', 1), card('b', 1), card('c', 2)]

  it('lands on the palace\'s first unscored card in queue order', () => {
    expect(findPalaceJumpTarget(cards, 1, new Set(['a']))).toEqual({
      cardId: 'b',
      complete: false,
    })
  })

  it('falls back to the last card when every card is scored', () => {
    expect(findPalaceJumpTarget(cards, 1, new Set(['a', 'b']))).toEqual({
      cardId: 'b',
      complete: true,
    })
  })

  it('returns null when the palace has no card in this round', () => {
    expect(findPalaceJumpTarget(cards, 3, new Set())).toBeNull()
  })
})

describe('round-plan membership', () => {
  const plan = {
    roundId: 'r',
    configSignature: '',
    createdAt: 0,
    candidateCount: 0,
    scheduledCount: 0,
    limitReached: false,
    orderIds: ['a', 'b'],
    cardsById: {
      a: {
        cardId: 'a',
        sourceCardId: 'a',
        occurrenceKind: 'source',
        retryAttempt: 0,
        palaceId: 1,
        palaceTitle: 'P1',
        label: 'a',
        kind: 'mindmap_branch',
        status: 'completed',
        lastRating: 3,
        retryAfterCards: 0,
        attemptCount: 1,
        updatedAt: 0,
      },
      b: {
        cardId: 'b',
        sourceCardId: 'b',
        occurrenceKind: 'source',
        retryAttempt: 0,
        palaceId: 2,
        palaceTitle: 'P2',
        label: 'b',
        kind: 'mindmap_branch',
        status: 'pending',
        lastRating: null,
        retryAfterCards: 0,
        attemptCount: 0,
        updatedAt: 0,
      },
    },
  } as FreestyleRoundPlanState

  it('finds scored source cards even when the queue filtered them out', () => {
    expect(completedSourceCardIdsForPalace(plan, 1, new Set(['a']))).toEqual(['a'])
    expect(completedSourceCardIdsForPalace(plan, 2, new Set(['a']))).toEqual([])
  })

  it('knows a palace is in the round without a live card', () => {
    expect(palaceHasPlanCards(plan, 1)).toBe(true)
    expect(palaceHasPlanCards(plan, 3)).toBe(false)
    expect(palaceHasPlanCards(null, 1)).toBe(false)
  })
})

describe('round palace statuses', () => {
  const segment = (palaceId: number | null, tone: 'done' | 'retry' | 'current' | 'pending') => ({
    cardId: `c-${palaceId}-${tone}`,
    tone,
    palaceId,
    palaceDone: false,
  })

  it('reads an unfilled tick as unrated work and a retry circle as 待重练', () => {
    const statuses = roundPalaceStatuses([
      segment(1, 'pending'),
      segment(2, 'retry'),
      segment(3, 'done'),
    ])

    expect(statuses.get(1)).toBe('unrated')
    expect(statuses.get(2)).toBe('retry')
    expect(statuses.get(3)).toBe('done')
  })

  it('a palace never claims to be further than its least-advanced tick', () => {
    const statuses = roundPalaceStatuses([
      segment(1, 'done'),
      segment(1, 'retry'),
      segment(1, 'pending'),
    ])

    expect(statuses.get(1)).toBe('unrated')
    expect(roundPalaceStatuses([segment(1, 'done'), segment(1, 'retry')]).get(1)).toBe('retry')
  })

  it('drops the hint row, which belongs to no palace', () => {
    expect(roundPalaceStatuses([segment(null, 'pending')]).size).toBe(0)
  })
})
