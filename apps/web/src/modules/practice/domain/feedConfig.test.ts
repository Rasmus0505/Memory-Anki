import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  sanitizeFreestyleFeedConfig,
} from './feedConfig'
import {
  DEFAULT_QUEUE_STATE,
  applySkip,
  findNextPalaceIndex,
  skipRemainingPalaceCards,
  filterMutedPalaces,
  mergeRefreshQueue,
  mutePalace,
  undoSkip,
  visibleMountIndices,
} from './queueState'
import type { FreestyleCard } from '@/shared/api/contracts'

describe('freestyle feed config', () => {
  it('sanitizes bounds and re-enables empty content', () => {
    const config = sanitizeFreestyleFeedConfig({
      node_limit: 99,
      queue_length: 2,
      content: { mindmap_branch: false, quiz_question: false },
      seed: 0,
    })
    expect(config.node_limit).toBe(50)
    expect(config.queue_length).toBe(5)
    expect(config.seed).toBe(1)
    expect(config.content.mindmap_branch).toBe(true)
    expect(config.content.quiz_question).toBe(true)
  })

  it('keeps defaults for empty input', () => {
    expect(sanitizeFreestyleFeedConfig(null)).toEqual(DEFAULT_FREESTYLE_FEED_CONFIG)
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

  it('finds the first card of the next palace and drops remaining same-palace cards', () => {
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

    const skipped = skipRemainingPalaceCards(cards, 1)
    expect(skipped.cards.map((card) => card.id)).toEqual(['a1', 'b1', 'b2'])
    expect(skipped.nextIndex).toBe(1)
    expect(skipped.cards[skipped.nextIndex]?.id).toBe('b1')
  })

  it('skips to an empty queue when the current palace is the last remaining', () => {
    const cards = [
      { id: 'a1', type: 'mindmap_branch', palace_id: 9 },
      { id: 'a2', type: 'mindmap_branch', palace_id: 9 },
    ] as FreestyleCard[]
    expect(findNextPalaceIndex(cards, 0)).toBe(null)
    const skipped = skipRemainingPalaceCards(cards, 0)
    expect(skipped.cards).toEqual([])
    expect(skipped.nextIndex).toBe(0)
  })
})
