import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { createRoundPlan, updateRoundPlanCard } from '@/modules/practice/domain/roundPlan'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildFreestyleProgressSummary,
  progressRailLabel,
  segmentTone,
} from './freestyleProgressSegments'

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
  }
}

function plan(cards: FreestyleCard[]) {
  return createRoundPlan('round-1', cards, DEFAULT_FREESTYLE_FEED_CONFIG)
}

describe('segmentTone', () => {
  it('collapses the plan statuses into the four tones a 2px rail can carry', () => {
    expect(segmentTone('active')).toBe('current')
    expect(segmentTone('completed')).toBe('done')
    expect(segmentTone('retry')).toBe('retry')
    expect(segmentTone('pending')).toBe('pending')
    // Too transient to earn its own hue.
    expect(segmentTone('stale')).toBe('pending')
    // Not part of the round: drawing it would make progress look artificially slow.
    expect(segmentTone('excluded')).toBeNull()
  })
})

describe('buildFreestyleProgressSummary', () => {
  it('tones each card from its plan status', () => {
    const cards = [card('one'), card('two'), card('three')]
    // `retry` comes from the plan entry's own status (written on a weak rating),
    // never derived from `passed` — planCardStatus does not read that field.
    const withRetry = updateRoundPlanCard(plan(cards), 'two', { status: 'retry' })
    const summary = buildFreestyleProgressSummary(cards, withRetry, ['one'], [], 'three')

    expect(summary.segments.map((segment) => segment.cardId)).toEqual(['one', 'two', 'three'])
    expect(summary.segments.map((segment) => segment.tone)).toEqual(['done', 'retry', 'current'])
    expect(summary.doneCount).toBe(1)
    expect(summary.retryCount).toBe(1)
  })

  it('draws both retry segments a weak rating produces', () => {
    // Production marks the source card retry AND inserts a retry occurrence that is
    // also retry, so one weak rating widens the amber band by two.
    const cards = [card('one'), card('one-retry'), card('two')]
    const marked = updateRoundPlanCard(plan(cards), 'one', { status: 'retry' })
    const withOccurrence = updateRoundPlanCard(marked, 'one-retry', {
      status: 'retry',
      occurrenceKind: 'retry',
      sourceCardId: 'one',
    })
    const summary = buildFreestyleProgressSummary(cards, withOccurrence, [], [], 'two')

    expect(summary.segments.map((segment) => segment.tone)).toEqual(['retry', 'retry', 'current'])
    expect(summary.retryCount).toBe(2)
  })

  it('drops excluded cards and counts position among rendered segments only', () => {
    const cards = [card('one'), card('gone'), card('two'), card('three')]
    // 'gone' is hidden, so 'two' is the 2nd rendered segment even though it is 3rd in cards.
    const summary = buildFreestyleProgressSummary(cards, plan(cards), [], ['gone'], 'two')

    expect(summary.segments.map((segment) => segment.cardId)).toEqual(['one', 'two', 'three'])
    expect(summary.total).toBe(3)
    expect(summary.position).toBe(2)
  })

  it('reports no position rather than a false completion when no card is current', () => {
    const cards = [card('one'), card('two')]
    // Happens mid-rebuild: currentCardId is null or points at a dropped card.
    const summary = buildFreestyleProgressSummary(cards, plan(cards), [], [], null)

    expect(summary.position).toBe(0)
    expect(summary.total).toBe(2)
  })

  it('returns an empty summary for an empty round', () => {
    const summary = buildFreestyleProgressSummary([], null, [], [], null)

    expect(summary.segments).toEqual([])
    expect(summary.total).toBe(0)
    expect(summary.position).toBe(0)
  })
})

describe('progressRailLabel', () => {
  it('speaks every count the decorative rail draws', () => {
    const cards = [card('one'), card('two'), card('three')]
    const withRetry = updateRoundPlanCard(plan(cards), 'two', { status: 'retry' })
    const summary = buildFreestyleProgressSummary(cards, withRetry, ['one'], [], 'three')

    expect(progressRailLabel(summary)).toBe('本轮进度 3/3，已通过 1，待重练 1。点击查看本轮安排')
  })

  it('omits zero counts', () => {
    const cards = [card('one'), card('two')]
    const summary = buildFreestyleProgressSummary(cards, plan(cards), [], [], 'one')

    expect(progressRailLabel(summary)).toBe('本轮进度 1/2。点击查看本轮安排')
  })

  it('never claims completion when there is no current card', () => {
    const cards = [card('one'), card('two')]
    const summary = buildFreestyleProgressSummary(cards, plan(cards), [], [], null)

    expect(progressRailLabel(summary)).toBe('本轮共 2 张。点击查看本轮安排')
  })

  it('states the empty round plainly', () => {
    expect(progressRailLabel(buildFreestyleProgressSummary([], null, [], [], null)))
      .toBe('本轮暂无安排。点击查看本轮安排')
  })
})
