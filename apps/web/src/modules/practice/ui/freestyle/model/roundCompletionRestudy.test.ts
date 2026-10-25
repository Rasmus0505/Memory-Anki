import { describe, expect, it } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  clampFreestyleFeedIndex,
  findEarliestCompleteSeekIndex,
  findEarliestUnhandledIndex,
  findUnscoredCompleteSeekIndices,
  freestyleCanPageNext,
  isFreestyleRoundComplete,
  resolveFreestyleCompleteSeek,
} from './roundCompletion'
import {
  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  isImmediateRestudyGap,
  restudyInterveningGap,
} from '@/modules/practice/domain/queueState'

function card(id: string): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '宫殿 A',
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: id }],
    node_uids: [`${id}-node`],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  } as FreestyleCard
}

function encounter(
  overrides: Partial<FreestyleUnitEncounterState> = {},
): FreestyleUnitEncounterState {
  return {
    encounterId: 'e-1',
    roundId: 'round-1',
    unitRevision: 1,
    status: 'closed',
    sessionId: 's-1',
    selectedRating: 3,
    passed: true,
    retryAfterCards: 0,
    ...overrides,
  }
}

describe('gap-0 restudy insert and canGoNext', () => {
  it('inserts the retry into the feed without requiring leave first', () => {
    const source = card('only')
    expect(isImmediateRestudyGap(0)).toBe(true)
    expect(restudyInterveningGap(0)).toBe(0)
    const occurrence = createRetryOccurrence(source, 'round-1', 1, 0)
    const next = insertRetryOccurrenceAfterGap([source], occurrence, 0, 0)
    expect(next.map((item) => item.id)).toEqual([source.id, occurrence.id])
    // Viewport stays on the source; 下一张 can move onto the retry.
    expect(clampFreestyleFeedIndex(1, next.length, false)).toBe(1)
    expect(freestyleCanPageNext(0, next.length, false, false)).toBe(true)
  })

  it('keeps 下一张 enabled on the last card while a pending restudy is uninserted', () => {
    // Fallback only. A successful 忘记/困难 already grew the feed, so this latch
    // covers the moment before that insert lands — not the steady state.
    expect(freestyleCanPageNext(2, 3, false, false)).toBe(false)
    expect(freestyleCanPageNext(2, 3, false, true)).toBe(true)
    expect(freestyleCanPageNext(3, 3, true, true)).toBe(false)
  })
})

describe('yellow boundary hint never blocks completion', () => {
  const hint = {
    id: 'review_hint:formal_review',
    type: 'review_hint',
    content_type: 'review_hint',
    text: '下一张：正式复习',
  } as FreestyleCard

  it('round is complete once every real card is scored', () => {
    const cards = [card('one'), hint, card('two')]
    expect(isFreestyleRoundComplete(cards, {
      one: encounter(),
      two: encounter(),
    }, [], null)).toBe(true)
    expect(isFreestyleRoundComplete(cards, {
      one: encounter(),
      two: encounter({ selectedRating: 1, passed: false }),
    }, [], null)).toBe(true)
  })

  it('round stays open while a real card is still unscored', () => {
    const cards = [card('one'), hint, card('two')]
    expect(isFreestyleRoundComplete(cards, { one: encounter() }, [], null)).toBe(false)
  })

  it('完成 seek targets the earliest real unscored card, never the hint', () => {
    const cards = [card('one'), hint, card('two')]
    expect(findEarliestCompleteSeekIndex(cards, {}, ['one'], null)).toBe(2)
    expect(findEarliestCompleteSeekIndex(cards, {}, ['one', 'two'], null)).toBeNull()
    expect(findEarliestUnhandledIndex(cards, {}, ['one', 'two'], null)).toBeNull()
  })
})

describe('a passed 重练 closes its source', () => {
  const retry = {
    ...card('retry:round-1:two:1'),
    source_card_id: 'two',
    occurrence_kind: 'retry' as const,
    retry_attempt: 1,
  }
  const cards = [card('one'), card('two'), retry]

  it('is complete when the source score fell out of the local ledger', () => {
    // 报告过的死锁：源卡的 困难 分数在本地账本里丢了，重练已经 记得。
    // 逐卡评分视角会认为源卡还没评分，完成就停在那一张永远评不了分的卡上。
    const encounters = {
      one: encounter(),
      [retry.id]: encounter({ selectedRating: 3, passed: true }),
    }
    const roundPlan = {
      cardsById: {
        one: { lastRating: 3, status: 'completed' },
        two: { lastRating: null, status: 'retry' },
        [retry.id]: { lastRating: 3, status: 'completed' },
      },
    } as never

    expect(isFreestyleRoundComplete(cards, encounters, [], roundPlan)).toBe(true)
    // 完成 既不再定位到那张改不了分的源卡，也不会因此禁用。
    expect(findUnscoredCompleteSeekIndices(cards, encounters, [], roundPlan)).toEqual([])
    expect(findEarliestCompleteSeekIndex(cards, encounters, [], roundPlan)).toBeNull()
    expect(resolveFreestyleCompleteSeek({
      roundComplete: true,
      cardCount: cards.length,
      earliestUnhandledIndex: null,
      visualIndex: 1,
      unscoredIndices: [],
    })).toBe(cards.length)
  })

  it('still keeps the round open while the 重练 itself is blank', () => {
    const roundPlan = {
      cardsById: {
        one: { lastRating: 3, status: 'completed' },
        two: { lastRating: null, status: 'retry' },
        [retry.id]: { lastRating: null, status: 'inserted' },
      },
    } as never
    expect(isFreestyleRoundComplete(cards, {}, [], roundPlan)).toBe(false)
    expect(findEarliestCompleteSeekIndex(cards, {}, [], roundPlan)).toBe(2)
  })
})
