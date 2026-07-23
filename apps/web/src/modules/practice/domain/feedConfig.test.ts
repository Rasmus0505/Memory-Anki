import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  sanitizeFreestyleFeedConfig,
} from './feedConfig'
import {
  DEFAULT_QUEUE_STATE,
  applyDeferredPalaceOrder,
  applySkip,
  deferPalace,
  findNextPalaceIndex,
  moveRemainingPalaceToTail,
  filterMutedPalaces,
  mergeQueuePreservingHistory,
  needsRestudyAfterRatings,
  placeRestudyCardAtTail,
  resolveRebuildIndex,
  resolveRestudyPreferCardId,
  mergeRefreshQueue,
  mutePalace,
  startNewRound,
  undoSkip,
  visibleMountIndices,
} from './queueState'
import type { FreestyleCard } from '@/shared/api/contracts'

describe('freestyle feed config', () => {
  it('sanitizes bounds and re-enables empty content', () => {
    const config = sanitizeFreestyleFeedConfig({
      node_limit: 99,
      queue_length: 2,
      content: { mindmap_branch: false, quiz_question: false, anki_card: false },
      seed: 0,
    })
    expect(config.node_limit).toBe(50)
    expect(config.queue_length).toBe(5)
    expect(config.seed).toBe(1)
    expect(config.content.mindmap_branch).toBe(true)
    expect(config.content.anki_card).toBe(true)
    expect(config.content.quiz_question).toBe(true)
  })

  it('keeps defaults for empty input', () => {
    expect(sanitizeFreestyleFeedConfig(null)).toEqual(DEFAULT_FREESTYLE_FEED_CONFIG)
  })

  it('defaults include_calendar_today_due to false and accepts true', () => {
    expect(sanitizeFreestyleFeedConfig({}).include_calendar_today_due).toBe(false)
    expect(
      sanitizeFreestyleFeedConfig({ include_calendar_today_due: true })
        .include_calendar_today_due,
    ).toBe(true)
  })
})

describe('freestyle queue skip rules', () => {
  it('moves to tail on first skip and hides on second', () => {
    const first = applySkip(
      {
        ...DEFAULT_QUEUE_STATE,
        skipCountById: {},
        hiddenIds: [],
        completedIds: [],
        mutedPalaceIds: [],
        lastSkippedId: null,
        lastSkippedAt: null,
      },
      'card-1',
      1000,
    )
    expect(first.action).toBe('to_tail')
    const second = applySkip(first.state, 'card-1', 2000)
    expect(second.action).toBe('hide')
    expect(second.state.hiddenIds).toContain('card-1')
  })

  it('undoes skip within window', () => {
    const skipped = applySkip(
      {
        ...DEFAULT_QUEUE_STATE,
        skipCountById: {},
        hiddenIds: [],
        completedIds: [],
        mutedPalaceIds: [],
        lastSkippedId: null,
        lastSkippedAt: null,
      },
      'card-1',
      1000,
    )
    const undone = undoSkip(skipped.state, 2000)
    expect(undone.skipCountById['card-1']).toBeUndefined()
    expect(undone.lastSkippedId).toBeNull()
  })

  it('keeps completed cards out of the refreshed visible queue', () => {
    const previous = [
      { id: 'a', type: 'mindmap_branch' },
      { id: 'b', type: 'mindmap_branch' },
    ] as FreestyleCard[]
    const incoming = [
      { id: 'c', type: 'mindmap_branch' },
      { id: 'd', type: 'mindmap_branch' },
    ] as FreestyleCard[]
    const merged = mergeRefreshQueue(previous, incoming)
    expect(merged.map((card) => card.id)).toEqual(['c', 'd'])
  })

  it('preserves completed quiz cards already in the feed so swipe-back still works', () => {
    const previous = [
      { id: 'quiz:1', type: 'quiz_question' },
      { id: 'quiz:2', type: 'quiz_question' },
      { id: 'quiz:3', type: 'quiz_question' },
    ] as FreestyleCard[]
    const incoming = [
      { id: 'quiz:3', type: 'quiz_question' },
      { id: 'quiz:4', type: 'quiz_question' },
    ] as FreestyleCard[]
    const merged = mergeQueuePreservingHistory(previous, incoming, ['quiz:1', 'quiz:2'])
    expect(merged.map((card) => card.id)).toEqual(['quiz:1', 'quiz:2', 'quiz:3', 'quiz:4'])
  })

  it('resolveRebuildIndex follows the user when they leave a just-finished card', () => {
    const nextCards = [
      { id: 'done' },
      { id: 'next' },
      { id: 'later' },
    ]

    // Still on the finished card → prefer stays under the viewport.
    expect(
      resolveRebuildIndex({
        nextCards,
        preferCardId: 'done',
        userCardId: 'done',
        fallbackIndex: 0,
      }),
    ).toBe(0)

    // Already swiped to the next card before silent rebuild resolves → do not yank back.
    expect(
      resolveRebuildIndex({
        nextCards,
        preferCardId: 'done',
        userCardId: 'next',
        fallbackIndex: 0,
      }),
    ).toBe(1)

    // Preferred card gone; keep the card the user is viewing.
    expect(
      resolveRebuildIndex({
        nextCards: [{ id: 'next' }, { id: 'later' }],
        preferCardId: 'done',
        userCardId: 'next',
        fallbackIndex: 0,
      }),
    ).toBe(0)

    // No user card known → fall back to prefer, then clamp.
    expect(
      resolveRebuildIndex({
        nextCards,
        preferCardId: 'later',
        userCardId: null,
        fallbackIndex: 99,
      }),
    ).toBe(2)
  })

  it('filters muted palaces and mounts nearby cards only', () => {
    const cards = [
      { id: '1', type: 'mindmap_branch', palace_id: 1 },
      { id: '2', type: 'mindmap_branch', palace_id: 2 },
    ] as FreestyleCard[]
    const muted = mutePalace(
      {
        ...DEFAULT_QUEUE_STATE,
        skipCountById: {},
        hiddenIds: [],
        completedIds: [],
        mutedPalaceIds: [],
        lastSkippedId: null,
        lastSkippedAt: null,
      },
      2,
    )
    expect(filterMutedPalaces(cards, muted.mutedPalaceIds).map((c) => c.id)).toEqual(['1'])
    expect([...visibleMountIndices(2, 6)].sort()).toEqual([1, 2, 3, 4])
  })

  it('finds the first card of the next palace and moves remaining same-palace cards to the tail', () => {
    const cards = [
      { id: 'a1', type: 'mindmap_branch', palace_id: 1 },
      { id: 'a2', type: 'mindmap_branch', palace_id: 1 },
      { id: 'a3', type: 'mindmap_branch', palace_id: 1 },
      { id: 'b1', type: 'mindmap_branch', palace_id: 2 },
      { id: 'b2', type: 'mindmap_branch', palace_id: 2 },
    ] as FreestyleCard[]
    expect(findNextPalaceIndex(cards, 0)).toBe(3)
    expect(findNextPalaceIndex(cards, 1)).toBe(3)
    expect(findNextPalaceIndex(cards, 3)).toBe(null)

    const skipped = moveRemainingPalaceToTail(cards, 1)
    expect(skipped.cards.map((card) => card.id)).toEqual(['a1', 'b1', 'b2', 'a2', 'a3'])
    expect(skipped.nextIndex).toBe(1)
    expect(skipped.cards[skipped.nextIndex]?.id).toBe('b1')
    expect(skipped.deferredPalaceId).toBe(1)
  })

  it('drops remaining cards when the current palace is the last remaining', () => {
    const cards = [
      { id: 'a1', type: 'mindmap_branch', palace_id: 9 },
      { id: 'a2', type: 'mindmap_branch', palace_id: 9 },
    ] as FreestyleCard[]
    expect(findNextPalaceIndex(cards, 0)).toBe(null)
    const skipped = moveRemainingPalaceToTail(cards, 0)
    expect(skipped.cards).toEqual([])
    expect(skipped.nextIndex).toBe(0)
    expect(skipped.deferredPalaceId).toBe(9)
  })

  it('keeps deferred palaces at the tail after rebuild order', () => {
    const cards = [
      { id: 'a1', type: 'mindmap_branch', palace_id: 1 },
      { id: 'b1', type: 'mindmap_branch', palace_id: 2 },
      { id: 'a2', type: 'mindmap_branch', palace_id: 1 },
      { id: 'c1', type: 'mindmap_branch', palace_id: 3 },
    ] as FreestyleCard[]
    const deferred = applyDeferredPalaceOrder(cards, [1], ['a1'])
    // Completed a1 stays; incomplete a2 goes to tail after non-deferred cards.
    expect(deferred.map((card) => card.id)).toEqual(['a1', 'b1', 'c1', 'a2'])
  })

  it('records deferred palaces and clears them on a new round', () => {
    const deferred = deferPalace(
      {
        ...DEFAULT_QUEUE_STATE,
        deferredPalaceIds: [2],
      },
      1,
    )
    expect(deferred.deferredPalaceIds).toEqual([2, 1])
    const redeferred = deferPalace(deferred, 2)
    expect(redeferred.deferredPalaceIds).toEqual([1, 2])

    const next = startNewRound(
      {
        ...DEFAULT_QUEUE_STATE,
        roundId: 'old-round',
        startedAt: 1,
        seed: 17,
        completedIds: ['a', 'b'],
        hiddenIds: ['c'],
        skipCountById: { a: 1 },
        mutedPalaceIds: [9, 12],
        deferredPalaceIds: [1, 2],
        lastSkippedId: 'c',
        lastSkippedAt: 99,
      },
      42,
      1_700_000_000_000,
    )
    expect(next.seed).toBe(42)
    expect(next.completedIds).toEqual([])
    expect(next.hiddenIds).toEqual([])
    expect(next.skipCountById).toEqual({})
    expect(next.lastSkippedId).toBeNull()
    expect(next.mutedPalaceIds).toEqual([9, 12])
    expect(next.deferredPalaceIds).toEqual([])
    expect(next.roundId).toBe('freestyle-round-1700000000000')
    expect(next.startedAt).toBe(1_700_000_000_000)
  })

  it('places restudy cards at the queue tail and always prefers the restudied unit (no auto-flip)', () => {
    const cards = [
      { id: 'a', type: 'mindmap_branch' },
      { id: 'b', type: 'mindmap_branch' },
      { id: 'c', type: 'mindmap_branch' },
    ] as FreestyleCard[]
    expect(placeRestudyCardAtTail(cards, 'b').map((card) => card.id)).toEqual([
      'a',
      'c',
      'b',
    ])
    expect(needsRestudyAfterRatings({ 忘记: 1, 困难: 0, 记得: 2, 轻松: 0 })).toBe(true)
    expect(needsRestudyAfterRatings({ 忘记: 0, 困难: 0, 记得: 2, 轻松: 1 })).toBe(false)

    const previous = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const nextMulti = [{ id: 'a' }, { id: 'c' }, { id: 'b' }]
    // Prefer the weak unit itself — never jump ahead to the next incomplete card.
    expect(
      resolveRestudyPreferCardId({
        previousCards: previous,
        nextCards: nextMulti,
        restudyCardId: 'b',
        completedIds: [],
      }),
    ).toBe('b')

    expect(
      resolveRestudyPreferCardId({
        previousCards: [{ id: 'b' }],
        nextCards: [{ id: 'b' }],
        restudyCardId: 'b',
        completedIds: [],
      }),
    ).toBe('b')

    expect(
      resolveRestudyPreferCardId({
        previousCards: previous,
        nextCards: [{ id: 'a' }, { id: 'c' }],
        restudyCardId: 'b',
        completedIds: [],
      }),
    ).toBeNull()
  })
})
