import { describe, expect, it } from 'vitest'
import { DEFAULT_FREESTYLE_FEED_CONFIG } from '@/modules/practice/domain/feedConfig'
import { applyCompletedIdsToRoundPlan, createRoundPlan, stampRestudyPlan, updateRoundPlanCard } from '@/modules/practice/domain/roundPlan'
import { createRetryOccurrence, insertRetryOccurrenceAfterGap } from '@/modules/practice/domain/queueState'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildFreestyleProgressSummary,
  palaceAccent,
  palaceAccentToneClass,
  freestyleProgressRailFits,
  progressHudText,
  progressRailLabel,
  progressRailRetryCountVisible,
  progressSegmentHoverLabel,
  progressSegmentShapeClass,
  liveEncounterFillDone,
  retryChromeClass,
  retryNodeLabel,
  retryNodeToneClass,
  segmentTone,
  visualPlanStatus,
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
  it('collapses plan statuses into tones; palace accent carries identity hue', () => {
    expect(segmentTone('active')).toBe('pending')
    expect(segmentTone('completed')).toBe('done')
    expect(segmentTone('retry')).toBe('retry')
    expect(segmentTone('pending')).toBe('pending')
    // Too transient for its own treatment.
    expect(segmentTone('stale')).toBe('pending')
    // Not part of the round: drawing it would make progress look artificially slow.
    expect(segmentTone('excluded')).toBeNull()
  })
})

describe('palaceAccent', () => {
  it('maps the same palaceId to a stable accent and null to neutral', () => {
    expect(palaceAccent(1)).toBe(palaceAccent(1))
    expect(palaceAccent(null)).toBe('neutral')
    expect(palaceAccent(1)).not.toBe(palaceAccent(2))
  })

  it('reuses a fixed palette so tone only changes opacity/overlay classes', () => {
    expect(palaceAccentToneClass(1, 'pending')).not.toBe(palaceAccentToneClass(1, 'current'))
    expect(palaceAccentToneClass(1, 'done')).not.toContain('bg-emerald-400')
    expect(palaceAccentToneClass(1, 'pending')).not.toBe(palaceAccentToneClass(2, 'pending'))
    expect(palaceAccentToneClass(null, 'pending')).toContain('bg-white/20')
  })

  it('keeps pending faint and done solid so unfinished vs finished is readable', () => {
    expect(palaceAccentToneClass(1, 'pending')).toContain('/25')
    expect(palaceAccentToneClass(1, 'done')).not.toMatch(/\/\d+/)
    expect(palaceAccentToneClass(null, 'done')).not.toMatch(/\/\d+/)
    expect(progressSegmentShapeClass('pending')).toBe('h-1.5')
    expect(progressSegmentShapeClass('done')).toBe('h-1.5')
    expect(progressSegmentShapeClass('current')).toContain('h-3.5')
    expect(progressSegmentShapeClass('current')).toContain('ring-2')
    expect(progressSegmentShapeClass('done', true)).toContain('h-3.5')
    expect(progressSegmentShapeClass('pending', true)).toContain('h-3.5')
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
    expect(summary.segments.map((segment) => segment.tone)).toEqual(['done', 'retry', 'pending'])
    expect(summary.segments.map((segment) => Boolean(segment.viewing))).toEqual([false, false, true])
    expect(summary.segments.map((segment) => segment.palaceId)).toEqual([1, 1, 1])
    expect(summary.segments.map((segment) => segment.kind)).toEqual(['source', 'source', 'source'])
    expect(summary.segments[1]).toMatchObject({ waitingRetry: true, retryAfterCards: 0 })
    expect(summary.segments.every((segment) => segment.palaceDone === false)).toBe(true)
    expect(summary.doneCount).toBe(1)
    expect(summary.retryCount).toBe(1)
    expect(summary.scheduledBase).toBe(3)
    expect(summary.positionBase).toBe(3)
    expect(summary.retryInserted).toBe(0)
    expect(summary.passedCount).toBe(1)
  })

  it('marks a source card waiting for retry without turning it into a retry node', () => {
    const cards = [card('one'), card('two')]
    const withRetry = updateRoundPlanCard(plan(cards), 'one', { status: 'retry', retryAfterCards: 3 })
    const summary = buildFreestyleProgressSummary(cards, withRetry, [], [], 'two')

    expect(summary.segments[0]).toMatchObject({
      cardId: 'one',
      kind: 'source',
      tone: 'retry',
      waitingRetry: true,
      retryAfterCards: 3,
    })
    expect(summary.segments[1].kind).toBe('source')
    expect(summary.segments[1].waitingRetry).toBeFalsy()
  })

  it('draws both retry segments a weak rating produces', () => {
    // Production marks the source card retry AND inserts a retry occurrence that is
    // also retry, so one weak rating widens the amber band by two.
    const cards = [
      card('one'),
      { ...card('retry:round-1:one:1'), source_card_id: 'one', occurrence_kind: 'retry' as const, retry_attempt: 1 },
      card('two'),
    ]
    const marked = updateRoundPlanCard(plan(cards), 'one', { status: 'retry', retryAfterCards: 3 })
    const withOccurrence = updateRoundPlanCard(marked, 'retry:round-1:one:1', {
      status: 'retry',
      occurrenceKind: 'retry',
      sourceCardId: 'one',
    })
    const summary = buildFreestyleProgressSummary(cards, withOccurrence, [], [], 'two')

    expect(summary.segments.map((segment) => segment.tone)).toEqual(['retry', 'retry', 'pending'])
    expect(summary.segments.map((segment) => segment.kind)).toEqual(['source', 'retry', 'source'])
    expect(summary.segments[0]).toMatchObject({ waitingRetry: true, retryAfterCards: 3 })
    expect(summary.segments[1]).toMatchObject({
      kind: 'retry',
      retryAttempt: 1,
      sourceCardId: 'one',
      sourceLabel: 'one',
    })
    expect(summary.retryCount).toBe(2)
    expect(summary.scheduledBase).toBe(2)
    expect(summary.retryInserted).toBe(1)
    expect(progressHudText(summary)).toBe('3/3')
    expect(progressRailLabel(summary)).toBe('本轮进度 3/3。点击查看本轮安排')
  })

  it('shows the faint amber retry node in the gap as soon as the rating stamps the plan', () => {
    const sources = [card('a'), card('b'), card('c'), card('d'), card('e')]
    const prior = plan(sources)
    const retry = createRetryOccurrence(sources[0], 'round-1', 1, 3)
    const inserted = insertRetryOccurrenceAfterGap(sources, retry, 0)
    const unstamped = buildFreestyleProgressSummary(inserted, prior, [], [], 'a')
    // The occurrence is in the feed but not in orderIds, so the rail dumps it at the tail.
    expect(unstamped.segments.map((segment) => segment.cardId)).toEqual(['a', 'b', 'c', 'd', 'e', retry.id])

    const stamped = stampRestudyPlan(prior, inserted, 'round-1', DEFAULT_FREESTYLE_FEED_CONFIG, [{
      cardId: 'a',
      rating: 1,
      retryAfterCards: 3,
      attempt: 1,
    }])
    const summary = buildFreestyleProgressSummary(inserted, stamped, [], [], 'a')
    expect(summary.segments.map((segment) => segment.cardId)).toEqual(['a', 'b', 'c', 'd', retry.id, 'e'])
    expect(summary.segments.map((segment) => segment.kind)).toEqual([
      'source', 'source', 'source', 'source', 'retry', 'source',
    ])
    expect(summary.segments[0]).toMatchObject({ waitingRetry: true, tone: 'done', viewing: true })
    expect(summary.segments[4]).toMatchObject({
      kind: 'retry',
      tone: 'retry',
      retryAttempt: 1,
      sourceCardId: 'a',
    })
    expect(retryNodeToneClass('retry')).toContain('bg-amber-400/25')
    expect(summary.retryInserted).toBe(1)
    expect(progressHudText(summary)).toBe('1/6')
  })

  it('marks a palace group done only when every rendered segment of it is done', () => {
    const cards = [
      card('one'),
      { ...card('two'), palace_id: 2, palace_title: '宫殿 B' },
      { ...card('three'), palace_id: 2, palace_title: '宫殿 B' },
    ]
    const summary = buildFreestyleProgressSummary(cards, plan(cards), ['one', 'two', 'three'], [], 'three')
    expect(summary.segments.map((segment) => segment.palaceDone)).toEqual([true, true, true])
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

  it('keeps a this-round completed tick filled when swipe-back opens an empty amend glance', () => {
    const cards = [card('one'), card('two')]
    const roundPlan = applyCompletedIdsToRoundPlan(plan(cards), ['one'])
    const encounters = {
      one: {
        encounterId: 'enc-one',
        unitRevision: 1,
        status: 'open' as const,
        sessionId: 'session-one',
        selectedRating: null,
        passed: null,
        retryAfterCards: 0,
      },
    }
    const summary = buildFreestyleProgressSummary(cards, roundPlan, ['one'], [], 'one', encounters)

    expect(summary.segments[0]).toMatchObject({ cardId: 'one', tone: 'done', viewing: true })
    expect(summary.segments[1]).toMatchObject({ cardId: 'two', tone: 'pending', viewing: false })
    expect(progressSegmentHoverLabel(summary.segments[0], 0, 2)).toBe('1/2 · 《one》 · 当前 · 已过')
    expect(summary.passedCount).toBe(1)
  })

  it('keeps a leftover retry source amber when today\'s glance has no selected rating yet', () => {
    const cards = [card('one'), card('two')]
    const withRetry = updateRoundPlanCard(plan(cards), 'one', { status: 'retry', retryAfterCards: 3 })
    const encounters = {
      one: {
        encounterId: 'enc-retry',
        unitRevision: 1,
        status: 'open' as const,
        sessionId: 'session-retry',
        selectedRating: null,
        passed: null,
        retryAfterCards: 3,
      },
    }
    const summary = buildFreestyleProgressSummary(cards, withRetry, [], [], 'one', encounters)

    expect(summary.segments[0]).toMatchObject({
      cardId: 'one',
      tone: 'retry',
      viewing: true,
      waitingRetry: true,
    })
  })

  it('keeps the viewing playhead on a rated card instead of dropping it into done height', () => {
    const cards = [card('one'), card('two')]
    const summary = buildFreestyleProgressSummary(cards, plan(cards), ['one'], [], 'one')

    expect(summary.segments[0]).toMatchObject({ cardId: 'one', tone: 'done', viewing: true })
    expect(summary.segments[1]).toMatchObject({ cardId: 'two', tone: 'pending', viewing: false })
    expect(progressSegmentShapeClass(summary.segments[0].tone, summary.segments[0].viewing)).toContain('h-3.5')
    expect(progressSegmentHoverLabel(summary.segments[0], 0, 2)).toContain('当前 · 已过')
  })

  it('keeps completed ticks from the plan when live cards only have remaining work', () => {
    const scheduled = [card('one'), card('two'), card('three')]
    const remaining = [card('two'), card('three')]
    const roundPlan = applyCompletedIdsToRoundPlan(plan(scheduled), ['one'])
    const summary = buildFreestyleProgressSummary(remaining, roundPlan, ['one'], [], 'two')

    expect(summary.segments.map((segment) => segment.cardId)).toEqual(['one', 'two', 'three'])
    expect(summary.segments.map((segment) => segment.tone)).toEqual(['done', 'pending', 'pending'])
    expect(summary.scheduledBase).toBe(3)
    expect(summary.passedCount).toBe(1)
    expect(progressHudText(summary)).toBe('2/3')
  })

  it('shows only one retry tick per source unit', () => {
    const cards = [
      card('one'),
      { ...card('retry:round-1:one:1'), source_card_id: 'one', occurrence_kind: 'retry' as const, retry_attempt: 1 },
      { ...card('retry:round-1:one:2'), source_card_id: 'one', occurrence_kind: 'retry' as const, retry_attempt: 2 },
      card('two'),
    ]
    const summary = buildFreestyleProgressSummary(cards, plan(cards), [], [], 'two')
    const retries = summary.segments.filter((segment) => segment.kind === 'retry')
    expect(retries).toHaveLength(1)
    expect(retries[0]?.retryAttempt).toBe(2)
    expect(summary.retryInserted).toBe(1)
  })

  it('tones a completed retry occurrence as done instead of leftover retry', () => {
    const cards = [
      card('one'),
      { ...card('retry:round-1:one:1'), source_card_id: 'one', occurrence_kind: 'retry' as const, retry_attempt: 1 },
      card('two'),
    ]
    const marked = updateRoundPlanCard(plan(cards), 'one', { status: 'completed' })
    const withOccurrence = updateRoundPlanCard(marked, 'retry:round-1:one:1', {
      status: 'completed',
      occurrenceKind: 'retry',
      sourceCardId: 'one',
    })
    const summary = buildFreestyleProgressSummary(
      cards,
      withOccurrence,
      ['one', 'retry:round-1:one:1'],
      [],
      'two',
    )

    expect(summary.segments.map((segment) => segment.kind)).toEqual(['source', 'retry', 'source'])
    expect(summary.segments.map((segment) => segment.tone)).toEqual(['done', 'done', 'pending'])
    expect(progressSegmentHoverLabel(summary.segments[1], 1, 3)).toBe('2/3 · 重练《one》第 1 次 · 已过')
  })

  it('keeps a retry occurrence tick when it is missing from live cards', () => {
    const scheduled = [
      card('one'),
      { ...card('retry:round-1:one:1'), source_card_id: 'one', occurrence_kind: 'retry' as const, retry_attempt: 1 },
      card('two'),
    ]
    const marked = updateRoundPlanCard(plan(scheduled), 'one', { status: 'retry', retryAfterCards: 3 })
    const withOccurrence = updateRoundPlanCard(marked, 'retry:round-1:one:1', {
      status: 'retry',
      occurrenceKind: 'retry',
      sourceCardId: 'one',
    })
    const summary = buildFreestyleProgressSummary(
      [card('one'), card('two')],
      withOccurrence,
      [],
      [],
      'two',
    )

    expect(summary.segments.map((segment) => segment.cardId)).toEqual(['one', 'retry:round-1:one:1', 'two'])
    expect(summary.segments.map((segment) => segment.tone)).toEqual(['retry', 'retry', 'pending'])
    expect(summary.segments.map((segment) => segment.kind)).toEqual(['source', 'retry', 'source'])
    expect(summary.segments[1]).toMatchObject({
      kind: 'retry',
      tone: 'retry',
      retryAttempt: 1,
      sourceCardId: 'one',
    })
    expect(summary.retryInserted).toBe(1)
  })

  it('marks the first today source as the leftover/today rail split', () => {
    const cards = [card('one'), card('two'), card('three')]
    const roundPlan = {
      ...plan(cards),
      today: '2026-09-18',
      cardsById: {
        ...plan(cards).cardsById,
        one: { ...plan(cards).cardsById.one, enteredOn: '2026-09-17' },
        two: { ...plan(cards).cardsById.two, enteredOn: '2026-09-17' },
        three: { ...plan(cards).cardsById.three, enteredOn: '2026-09-18' },
      },
    }
    const summary = buildFreestyleProgressSummary(cards, roundPlan, [], [], 'one')
    expect(summary.segments.map((segment) => Boolean(segment.cohortBoundary))).toEqual([
      false,
      false,
      true,
    ])
  })
})

describe('progressSegmentHoverLabel', () => {
  it('names the hovered tick as that card, not the current card', () => {
    const cards = [card('one'), card('two'), card('three')]
    const summary = buildFreestyleProgressSummary(cards, plan(cards), ['one'], [], 'two')

    expect(progressSegmentHoverLabel(summary.segments[0], 0, 3)).toBe('1/3 · 《one》 · 已过')
    expect(progressSegmentHoverLabel(summary.segments[1], 1, 3)).toBe('2/3 · 《two》 · 当前')
    expect(progressSegmentHoverLabel(summary.segments[2], 2, 3)).toBe('3/3 · 《three》 · 待练')
  })

  it('keeps retry occurrence copy on that tick', () => {
    expect(
      progressSegmentHoverLabel(
        {
          cardId: 'retry:1',
          tone: 'retry',
          palaceId: 1,
          palaceDone: false,
          kind: 'retry',
          retryAttempt: 2,
          sourceLabel: '锚点',
        },
        1,
        4,
      ),
    ).toBe('2/4 · 重练《锚点》第 2 次 · 待重练')
    expect(
      progressSegmentHoverLabel(
        {
          cardId: 'retry:1',
          tone: 'done',
          palaceId: 1,
          palaceDone: false,
          kind: 'retry',
          retryAttempt: 2,
          sourceLabel: '锚点',
        },
        1,
        4,
      ),
    ).toBe('2/4 · 重练《锚点》第 2 次 · 已过')
  })
})

describe('progressRailRetryCountVisible', () => {
  function retrySegment(id: string, attempt: number, viewing = false) {
    return {
      cardId: id,
      tone: viewing ? 'current' as const : 'retry' as const,
      palaceId: 1,
      palaceDone: false,
      kind: 'retry' as const,
      retryAttempt: attempt,
      viewing,
      sourceLabel: '卡',
    }
  }

  it('keeps every retry count when the circles fit', () => {
    const segments = [retrySegment('a', 1), retrySegment('b', 7, true), retrySegment('c', 2)]
    expect(freestyleProgressRailFits(segments, 400)).toBe(true)
    expect(segments.map((_, index) => progressRailRetryCountVisible(segments, index, 400)))
      .toEqual([true, true, true])
  })

  it('keeps counts only within two cards of the playhead when the rail is narrow', () => {
    const segments = Array.from({ length: 12 }, (_, index) => (
      retrySegment(`retry-${index}`, index === 5 ? 7 : index + 1, index === 5)
    ))
    expect(freestyleProgressRailFits(segments, 96)).toBe(false)
    const visible = segments.map((_, index) => progressRailRetryCountVisible(segments, index, 96))
    expect(visible).toEqual([
      false, false, false, true, true, true, true, true, false, false, false, false,
    ])
    expect(progressRailRetryCountVisible(segments, 5, 0)).toBe(true)
  })
})

describe('retryNodeLabel', () => {
  it('names a retry node from the source label and attempt', () => {
    expect(
      retryNodeLabel({
        cardId: 'retry:1',
        tone: 'retry',
        palaceId: 1,
        palaceDone: false,
        kind: 'retry',
        retryAttempt: 2,
        sourceLabel: '锚点',
      }),
    ).toBe('重练《锚点》第 2 次')
    expect(
      retryNodeLabel({
        cardId: 'retry:1',
        tone: 'retry',
        palaceId: 1,
        palaceDone: false,
        kind: 'retry',
        retryAttempt: 1,
      }),
    ).toBe('重练第 1 次')
  })

  it('keeps unfinished retry faint and completed retry solid', () => {
    expect(retryNodeToneClass('pending')).toContain('/25')
    expect(retryNodeToneClass('retry')).toContain('/25')
    expect(retryNodeToneClass('done')).toBe('bg-amber-400 text-zinc-950')
    expect(retryNodeToneClass('done')).not.toMatch(/\/\d+/)
    expect(retryChromeClass(false)).toContain('bg-amber-400')
    expect(retryChromeClass(true)).toContain('bg-emerald-500/12')
    const emptyGlance = {
      encounterId: 'enc',
      unitRevision: 1,
      status: 'open' as const,
      sessionId: 'session',
      selectedRating: null,
      passed: null,
      retryAfterCards: 0,
    }
    expect(visualPlanStatus('completed', emptyGlance)).toBe('completed')
    expect(visualPlanStatus('active', emptyGlance, 'retry')).toBe('retry')
    expect(visualPlanStatus('pending', {
      encounterId: 'enc',
      unitRevision: 1,
      status: 'closed',
      sessionId: 'session',
      selectedRating: 1,
      passed: false,
      retryAfterCards: 0,
    })).toBe('completed')
    expect(liveEncounterFillDone({
      encounterId: 'enc',
      unitRevision: 1,
      status: 'closed',
      sessionId: 'session',
      selectedRating: 1,
      passed: false,
      retryAfterCards: 0,
    }, false)).toBe(true)
    expect(liveEncounterFillDone({
      encounterId: 'enc',
      unitRevision: 1,
      status: 'closed',
      sessionId: 'session',
      selectedRating: 3,
      passed: true,
      retryAfterCards: 0,
    }, false)).toBe(true)
    expect(liveEncounterFillDone({
      encounterId: 'enc',
      unitRevision: 1,
      status: 'open',
      sessionId: 'session',
      selectedRating: null,
      passed: null,
      retryAfterCards: 0,
    }, true)).toBe(true)
  })
})

describe('progressRailLabel', () => {
  it('speaks every count the decorative rail draws', () => {
    const cards = [card('one'), card('two'), card('three')]
    const withRetry = updateRoundPlanCard(plan(cards), 'two', { status: 'retry' })
    const summary = buildFreestyleProgressSummary(cards, withRetry, ['one'], [], 'three')

    expect(progressRailLabel(summary)).toBe('本轮进度 3/3。点击查看本轮安排')
    expect(progressHudText(summary)).toBe('3/3')
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

describe('yellow boundary hint segment', () => {
  const hint: FreestyleCard = {
    id: 'review_hint:formal_review',
    type: 'review_hint',
    content_type: 'review_hint',
    text: '下一张：正式复习',
  }
  const pathCard: FreestyleCard = {
    id: 'path',
    type: 'anki_card',
    content_type: 'anki_card',
    presentation: 'anki',
    palace_id: 1,
    palace_title: '宫殿 A',
    anchor_uid: 'path-anchor',
    context_path: [{ uid: 'path-anchor', text: 'path' }],
    node_uids: ['path-node'],
    node_count: 1,
  }

  it('seats the plan-external hint before the first formal review unit', () => {
    const cards = [pathCard, hint, card('one'), card('two')]
    // The plan only knows server cards — the hint is feed presentation.
    const summary = buildFreestyleProgressSummary(
      cards,
      plan([pathCard, card('one'), card('two')]),
      [],
      [],
      'path',
    )

    expect(summary.segments.map((segment) => segment.cardId))
      .toEqual(['path', 'review_hint:formal_review', 'one', 'two'])
    expect(summary.total).toBe(4)
    expect(progressHudText(summary)).toBe('1/4')
  })

  it('keeps the hint out of scheduledBase and labels it 提示 with a neutral accent', () => {
    const cards = [pathCard, hint, card('one')]
    const summary = buildFreestyleProgressSummary(
      cards,
      plan([pathCard, card('one')]),
      [],
      [],
      'review_hint:formal_review',
    )

    const hintSegment = summary.segments.find(
      (segment) => segment.cardId === 'review_hint:formal_review',
    )
    expect(hintSegment).toMatchObject({
      tone: 'pending',
      palaceId: null,
      viewing: true,
      sourceLabel: '提示',
    })
    expect(summary.scheduledBase).toBe(2)
    expect(summary.position).toBe(2)
  })

  it('keeps plan-first ordering intact when the hint is already before the review unit', () => {
    const cards = [pathCard, hint, card('one')]
    const summary = buildFreestyleProgressSummary(
      cards,
      plan([pathCard, card('one')]),
      [],
      [],
      null,
    )
    expect(summary.segments.map((segment) => segment.cardId))
      .toEqual(['path', 'review_hint:formal_review', 'one'])
  })
})
