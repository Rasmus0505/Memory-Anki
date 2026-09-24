import { describe, expect, it } from 'vitest'
import type { FreestyleUnitEncounterState } from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildFreestyleRoundCompletion,
  clampFreestyleFeedIndex,
  findEarliestCompleteSeekIndex,
  findEarliestUnhandledIndex,
  freestyleCanPageNext,
  freestyleFeedSlotCount,
  isFreestyleCompleteSlot,
  isFreestyleRoundComplete,
  resolveFreestyleCompleteSeek,
} from './roundCompletion'
import {
  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  isImmediateRestudyGap,
  restudyInterveningGap,
} from '@/modules/practice/domain/queueState'

function card(
  id: string,
  overrides: Partial<FreestyleCard> & { palace_id?: number; palace_title?: string } = {},
): FreestyleCard {
  const palaceId = overrides.palace_id ?? 1
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: overrides.palace_title ?? `宫殿 ${palaceId === 1 ? 'A' : palaceId}`,
    anchor_uid: `${id}-anchor`,
    context_path: [{ uid: `${id}-anchor`, text: id }],
    node_uids: [`${id}-node`],
    node_count: 1,
    unit_id: `${id}-unit`,
    unit_revision: 1,
    ...overrides,
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

describe('buildFreestyleRoundCompletion', () => {
  it('splits ratings into passed and retry', () => {
    const cards = [card('one'), card('two'), card('three')]
    const completion = buildFreestyleRoundCompletion(cards, {
      one: encounter(),
      two: encounter({ selectedRating: 1, passed: false }),
      three: encounter({ selectedRating: 4 }),
    }, 3)

    expect(completion.ratedCount).toBe(3)
    expect(completion.passedCount).toBe(2)
    expect(completion.retryCount).toBe(1)
    expect(completion.retriedCount).toBe(1)
  })

  it('counts a failed source and its later passed retry as one restudied unit', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const completion = buildFreestyleRoundCompletion(
      [card('one'), card('two'), retry],
      {
        one: encounter(),
        two: encounter({ selectedRating: 1, passed: false }),
        [retry.id]: encounter({ selectedRating: 3, passed: true }),
      },
      9,
      { scheduledCount: 2 },
    )

    expect(completion.ratedCount).toBe(2)
    expect(completion.passedCount).toBe(2)
    expect(completion.retriedCount).toBe(1)
    expect(completion.remainingCandidates).toBe(7)
  })

  it('treats acknowledged cards as handled without an encounter', () => {
    const cards = [card('one'), card('quiz-1')]
    expect(isFreestyleRoundComplete(cards, { one: encounter() })).toBe(false)
    expect(isFreestyleRoundComplete(cards, { one: encounter() }, ['quiz-1'])).toBe(true)

    const completion = buildFreestyleRoundCompletion(
      cards,
      { one: encounter() },
      2,
      { completedIds: ['quiz-1'], scheduledCount: 2 },
    )
    expect(completion.ratedCount).toBe(2)
    expect(completion.passedCount).toBe(2)
  })

  it('ignores cards the learner never rated', () => {
    const cards = [card('one'), card('two')]
    const completion = buildFreestyleRoundCompletion(cards, {
      one: encounter(),
      two: encounter({ selectedRating: null, passed: null, status: 'open' }),
    }, 2)

    expect(completion.ratedCount).toBe(1)
    expect(completion.passedCount).toBe(1)
    expect(completion.retryCount).toBe(0)
  })

  it('reports candidates the round limit left out', () => {
    const cards = [card('one'), card('two')]
    const completion = buildFreestyleRoundCompletion(cards, { one: encounter() }, 9)

    expect(completion.remainingCandidates).toBe(7)
  })

  it('never reports negative remaining candidates', () => {
    const cards = [card('one'), card('two'), card('three')]
    // Restudy re-insertion can push the feed past the original candidate count.
    const completion = buildFreestyleRoundCompletion(cards, {}, 2, { scheduledCount: 2 })

    expect(completion.remainingCandidates).toBe(0)
  })

  it('sums billable effectiveSeconds across closed rated encounters', () => {
    const cards = [card('one'), card('two'), card('three')]
    const completion = buildFreestyleRoundCompletion(cards, {
      one: encounter({ effectiveSeconds: 12 }),
      two: encounter({ selectedRating: 1, passed: false, effectiveSeconds: 8 }),
      three: encounter({ selectedRating: null, passed: null, status: 'open', effectiveSeconds: 99 }),
    }, 3)

    expect(completion.totalEffectiveSeconds).toBe(20)
  })

  it('groups attempted sources by subject and palace with retry seconds included', () => {
    const retry = {
      ...card('retry:round-1:two:1', { palace_id: 2, palace_title: '宫殿 B' }),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const cards = [
      card('one', { palace_id: 1, palace_title: '宫殿 A' }),
      card('two', { palace_id: 2, palace_title: '宫殿 B' }),
      retry,
      card('three', { palace_id: 3, palace_title: '宫殿 C' }),
    ]
    const completion = buildFreestyleRoundCompletion(
      cards,
      {
        one: encounter({ effectiveSeconds: 10 }),
        two: encounter({ selectedRating: 1, passed: false, effectiveSeconds: 5 }),
        [retry.id]: encounter({ selectedRating: 3, passed: true, effectiveSeconds: 7 }),
        three: encounter({ effectiveSeconds: 3 }),
      },
      3,
      {
        subjectByPalaceId: new Map([
          [1, { id: 10, name: '学科甲' }],
          [2, { id: 10, name: '学科甲' }],
          [3, { id: 20, name: '学科乙' }],
        ]),
      },
    )

    expect(completion.totalEffectiveSeconds).toBe(25)
    expect(completion.bySubject).toEqual([
      {
        subjectId: 10,
        subjectName: '学科甲',
        palaceCount: 2,
        cardCount: 2,
        effectiveSeconds: 22,
        palaces: [
          { palaceId: 2, palaceTitle: '宫殿 B', cardCount: 1, effectiveSeconds: 12 },
          { palaceId: 1, palaceTitle: '宫殿 A', cardCount: 1, effectiveSeconds: 10 },
        ],
      },
      {
        subjectId: 20,
        subjectName: '学科乙',
        palaceCount: 1,
        cardCount: 1,
        effectiveSeconds: 3,
        palaces: [
          { palaceId: 3, palaceTitle: '宫殿 C', cardCount: 1, effectiveSeconds: 3 },
        ],
      },
    ])
  })

  it('counts open or unrated encounters as zero billable seconds', () => {
    const cards = [card('one'), card('two')]
    const completion = buildFreestyleRoundCompletion(cards, {
      one: encounter({ status: 'open', selectedRating: null, passed: null, effectiveSeconds: 40 }),
      two: encounter({ status: 'closed', selectedRating: null, passed: null, effectiveSeconds: 15 }),
    }, 2)

    expect(completion.totalEffectiveSeconds).toBe(0)
    expect(completion.bySubject).toEqual([])
  })

  it('falls back to 未分类 when the subject map is missing a palace', () => {
    const cards = [card('one', { palace_id: 9, palace_title: '独立宫殿' })]
    const completion = buildFreestyleRoundCompletion(
      cards,
      { one: encounter({ effectiveSeconds: 6 }) },
      1,
    )

    expect(completion.bySubject).toEqual([
      {
        subjectId: null,
        subjectName: '未分类',
        palaceCount: 1,
        cardCount: 1,
        effectiveSeconds: 6,
        palaces: [
          { palaceId: 9, palaceTitle: '独立宫殿', cardCount: 1, effectiveSeconds: 6 },
        ],
      },
    ])
  })

  it('uses the round clock for the headline and palace rows, and does not add encounter seconds again', () => {
    const cards = [
      card('one', { palace_id: 11, palace_title: '卢梭' }),
      card('two', { palace_id: 12, palace_title: '康德' }),
    ]
    const completion = buildFreestyleRoundCompletion(
      cards,
      {
        one: encounter({ effectiveSeconds: 999 }),
        two: encounter({ effectiveSeconds: 999 }),
      },
      2,
      {
        subjectByPalaceId: new Map([[11, { id: 1, name: '教育学' }]]),
        learningTime: {
          unitSeconds: 100,
          quizSeconds: 40,
          lookupSeconds: 10,
          backfilled: true,
          byPalace: {
            '11': { unitSeconds: 80, quizSeconds: 0, lookupSeconds: 0 },
            '12': { unitSeconds: 0, quizSeconds: 25, lookupSeconds: 10 },
          },
        },
      },
    )

    expect(completion.totalEffectiveSeconds).toBe(150)
    expect(completion.quizSeconds).toBe(40)
    const education = completion.bySubject.find((subject) => subject.subjectName === '教育学')
    const uncategorized = completion.bySubject.find((subject) => subject.subjectName === '未分类')
    expect(education?.palaces.find((palace) => palace.palaceId === 11)?.effectiveSeconds).toBe(80)
    expect(uncategorized?.palaces.find((palace) => palace.palaceId === 12)?.effectiveSeconds).toBe(35)
    expect(education?.effectiveSeconds).toBe(80)
  })
})

describe('isFreestyleRoundComplete', () => {
  it('opens settlement once every presented card is scored, including a weak rating', () => {
    const cards = [card('one'), card('two')]

    expect(isFreestyleRoundComplete(cards, { one: encounter() })).toBe(false)
    // 忘记/困难 is scored. Nothing unscored remains, so 完成 must enter settlement
    // instead of disabling.
    expect(isFreestyleRoundComplete(cards, {
      one: encounter(),
      two: encounter({ selectedRating: 2, passed: false }),
    })).toBe(true)

    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(isFreestyleRoundComplete([cards[0], cards[1], retry], {
      one: encounter(),
      two: encounter({ selectedRating: 2, passed: false }),
    })).toBe(false)
    expect(isFreestyleRoundComplete([cards[0], cards[1], retry], {
      one: encounter(),
      two: encounter({ selectedRating: 2, passed: false }),
      [retry.id]: encounter({ selectedRating: 3, passed: true }),
    })).toBe(true)
  })

  it('is never complete for an empty feed', () => {
    // Empty round shows the empty state, not a summary.
    expect(isFreestyleRoundComplete([], {})).toBe(false)
  })

  it('is incomplete while a card holds an open unrated encounter', () => {
    const cards = [card('one')]

    expect(isFreestyleRoundComplete(cards, {
      one: encounter({ selectedRating: null, passed: null, status: 'open' }),
    })).toBe(false)
  })

  it('is complete when swipe-back left an empty amend glance with this-round lastRating', () => {
    const cards = [card('one'), card('two')]
    const emptyAmend = encounter({ selectedRating: null, passed: null, status: 'open' })
    const roundPlan = {
      cardsById: {
        one: { lastRating: 3, status: 'completed' },
        two: { lastRating: 4, status: 'completed' },
      },
    } as never

    expect(isFreestyleRoundComplete(cards, { one: emptyAmend, two: emptyAmend }, [], roundPlan)).toBe(true)
  })

  it('stays incomplete while a retry copy has not been scored', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const roundPlan = {
      cardsById: {
        one: { lastRating: 3, status: 'completed' },
        two: { lastRating: 2, status: 'retry' },
        [retry.id]: { lastRating: null, status: 'retry' },
      },
    } as never
    expect(isFreestyleRoundComplete(
      [card('one'), card('two'), retry],
      { two: encounter({ selectedRating: null, passed: null, status: 'open' }) },
      [],
      roundPlan,
    )).toBe(false)
  })
})

describe('freestyle feed complete slot', () => {
  it('adds one snap slot after the last unit when the round is complete', () => {
    expect(freestyleFeedSlotCount(3, true)).toBe(4)
    expect(freestyleFeedSlotCount(3, false)).toBe(3)
    expect(freestyleFeedSlotCount(0, true)).toBe(0)
  })

  it('treats the extra index as the closing slot, not a card', () => {
    expect(isFreestyleCompleteSlot(3, 3, true)).toBe(true)
    expect(isFreestyleCompleteSlot(2, 3, true)).toBe(false)
    expect(isFreestyleCompleteSlot(3, 3, false)).toBe(false)
  })

  it('lets 下一张 land on the closing slot instead of clamping to the last unit', () => {
    expect(clampFreestyleFeedIndex(3, 3, true)).toBe(3)
    expect(clampFreestyleFeedIndex(3, 3, false)).toBe(2)
    expect(clampFreestyleFeedIndex(-1, 3, true)).toBe(0)
  })
})

describe('findEarliestUnhandledIndex', () => {
  it('seeks the unfinished retry instead of the weak-rated source', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(findEarliestUnhandledIndex(
      [card('one'), card('two'), retry],
      {
        one: encounter(),
        two: encounter({ selectedRating: 2, passed: false }),
      },
    )).toBe(2)
  })

  it('finds a weak-rated source when its retry copy is still missing', () => {
    const cards = [card('one'), card('two')]
    expect(findEarliestUnhandledIndex(cards, {
      one: encounter(),
      two: encounter({ selectedRating: 2, passed: false }),
    })).toBe(1)
  })

  it('finds an unrated skipped-ahead card before later rated work', () => {
    const cards = [card('one'), card('two'), card('three')]
    expect(findEarliestUnhandledIndex(cards, {
      two: encounter(),
      three: encounter({ selectedRating: 4 }),
    })).toBe(0)
  })

  it('skips a weak source once its retry has passed', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(findEarliestUnhandledIndex(
      [card('one'), card('two'), retry],
      {
        one: encounter(),
        two: encounter({ selectedRating: 1, passed: false }),
        [retry.id]: encounter({ selectedRating: 3, passed: true }),
      },
    )).toBeNull()
  })

  it('seeks the retry when the hard rating is missing from the source card', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const roundPlan = {
      cardsById: {
        one: { lastRating: 3, status: 'completed' },
        two: { status: 'retry', lastRating: null },
        [retry.id]: { status: 'retry', lastRating: null, occurrenceKind: 'retry', sourceCardId: 'two' },
      },
    } as never
    expect(findEarliestUnhandledIndex(
      [card('one'), card('two'), retry],
      { two: encounter({ selectedRating: null, passed: null, status: 'open' }) },
      [],
      roundPlan,
    )).toBe(2)
  })

  it('seeks the retry when the source card id was rewritten to a new revision', () => {
    const source = card('review_unit:u1:r2', { unit_id: 'u1' })
    const retry = {
      ...card('retry:round-1:u1:1', { unit_id: 'u1' }),
      source_card_id: 'review_unit:u1:r1',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(findEarliestUnhandledIndex(
      [card('one'), source, retry],
      {
        one: encounter(),
        [source.id]: encounter({ selectedRating: 2, passed: false }),
      },
    )).toBe(2)
  })

  it('seeks the retry even when the plan copied the weak rating onto it', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const roundPlan = {
      cardsById: {
        two: { lastRating: 2, status: 'retry', sourceCardId: 'two' },
        [retry.id]: { lastRating: 2, status: 'retry', occurrenceKind: 'retry', sourceCardId: 'two' },
      },
    } as never
    expect(findEarliestUnhandledIndex(
      [card('one'), card('two'), retry],
      { one: encounter(), two: encounter({ selectedRating: 2, passed: false }) },
      [],
      roundPlan,
    )).toBe(2)
  })

  it('seeks the later retry after an earlier retry was also rated hard', () => {
    const first = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const second = {
      ...card('retry:round-1:two:2'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 2,
    }
    expect(findEarliestUnhandledIndex(
      [card('one'), card('two'), first, second],
      {
        one: encounter(),
        two: encounter({ selectedRating: 2, passed: false }),
        [first.id]: encounter({ selectedRating: 2, passed: false }),
      },
    )).toBe(3)
  })
})

describe('findEarliestCompleteSeekIndex', () => {
  it('prefers an unrated unit over an earlier weak-rated retry', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    // Regression: 完成 used to land on the already-困难 retry at index 2.
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two'), retry, card('four')],
      {
        one: encounter({ selectedRating: 3, passed: true }),
        two: encounter({ selectedRating: 2, passed: false }),
        [retry.id]: encounter({ selectedRating: 2, passed: false }),
      },
    )).toBe(3)
  })

  it('does not re-target an already-scored retry when nothing is unrated', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two'), retry],
      {
        one: encounter({ selectedRating: 3, passed: true }),
        two: encounter({ selectedRating: 3, passed: true }),
        [retry.id]: encounter({ selectedRating: 2, passed: false }),
      },
    )).toBeNull()
  })

  it('does not seek an already-scored weak source (已评分就填实心)', () => {
    // 产品：完成只跳「还没评分」；弱源已评分，等 leave 插入空白重练后再跳。
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two')],
      {
        one: encounter({ selectedRating: 3, passed: true }),
        two: encounter({ selectedRating: 1, passed: false }),
      },
    )).toBeNull()
  })

  it('seeks the unrated retry after a weak source when the copy is in the feed', () => {
    const retry = {
      ...card('retry:round-1:two:1'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two'), retry],
      {
        one: encounter({ selectedRating: 3, passed: true }),
        two: encounter({ selectedRating: 2, passed: false }),
      },
    )).toBe(2)
  })

  it('finds a skipped-ahead unrated card before later rated work', () => {
    expect(findEarliestCompleteSeekIndex(
      [card('one'), card('two'), card('three')],
      {
        one: encounter({ selectedRating: 4, passed: true }),
        three: encounter({ selectedRating: 3, passed: true }),
      },
    )).toBe(1)
  })
})

describe('resolveFreestyleCompleteSeek', () => {
  it('opens the settlement slot when the round is already handled', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: true,
      cardCount: 3,
      earliestUnhandledIndex: null,
      visualIndex: 2,
    })).toBe(3)
  })

  it('does nothing on the settlement slot itself', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: true,
      cardCount: 3,
      earliestUnhandledIndex: null,
      visualIndex: 3,
    })).toBeNull()
  })

  it('seeks the earliest unfinished unit when the round is still open', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: false,
      cardCount: 4,
      earliestUnhandledIndex: 1,
      visualIndex: 3,
    })).toBe(1)
  })

  it('does nothing when already on the earliest unfinished unit', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: false,
      cardCount: 4,
      earliestUnhandledIndex: 1,
      visualIndex: 1,
    })).toBeNull()
  })

  it('opens settlement after the last unscored card is rated, even on a weak score', () => {
    expect(resolveFreestyleCompleteSeek({
      roundComplete: true,
      cardCount: 2,
      earliestUnhandledIndex: null,
      visualIndex: 1,
    })).toBe(2)
  })
})

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
