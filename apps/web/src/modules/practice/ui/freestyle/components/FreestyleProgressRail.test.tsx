import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  palaceAccent,
  palaceAccentToneClass,
  progressSegmentShapeClass,
  retryNodeToneClass,
  type FreestyleProgressSummary,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { FreestyleProgressRail } from './FreestyleProgressRail'

function summary(overrides: Partial<FreestyleProgressSummary> = {}): FreestyleProgressSummary {
  return {
    segments: [
      { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, kind: 'source', sourceLabel: 'one' },
      { cardId: 'two', tone: 'retry', palaceId: 1, palaceDone: false, kind: 'source', sourceLabel: 'two', waitingRetry: true },
      { cardId: 'three', tone: 'current', palaceId: 2, palaceDone: false, kind: 'source', sourceLabel: 'three' },
      { cardId: 'four', tone: 'pending', palaceId: 2, palaceDone: false, kind: 'source', sourceLabel: 'four' },
    ],
    position: 3,
    total: 4,
    doneCount: 1,
    retryCount: 1,
    scheduledBase: 4,
    positionBase: 3,
    retryInserted: 0,
    passedCount: 1,
    ...overrides,
  }
}

function renderRail(overrides: Partial<Parameters<typeof FreestyleProgressRail>[0]> = {}) {
  const onOpenPlan = vi.fn()
  const props = {
    summary: summary(),
    onOpenPlan,
    ...overrides,
  }
  render(
    <TooltipProvider>
      <FreestyleProgressRail {...props} />
    </TooltipProvider>,
  )
  return { onOpenPlan }
}

describe('FreestyleProgressRail', () => {
  it('draws one segment per card so restudy re-insertion stays visible', () => {
    renderRail()

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments).toHaveLength(4)
    expect(segments.map((node) => node.getAttribute('data-tone')))
      .toEqual(['done', 'retry', 'current', 'pending'])
    expect(segments[0].className).toContain(progressSegmentShapeClass('done'))
    expect(segments[2].className).toContain(progressSegmentShapeClass('current', true))
    expect(segments[3].className).toContain(progressSegmentShapeClass('pending'))
    expect(screen.getByTestId('freestyle-progress-rail').className).toContain('h-7')
  })

  it('colors segments by palace identity, not a whole-palace emerald override', () => {
    renderRail({
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: true },
          { cardId: 'two', tone: 'done', palaceId: 1, palaceDone: true },
          { cardId: 'three', tone: 'current', palaceId: 2, palaceDone: false },
          { cardId: 'four', tone: 'pending', palaceId: 2, palaceDone: false },
          { cardId: 'five', tone: 'pending', palaceId: null, palaceDone: false },
        ],
      }),
    })

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments.map((node) => node.getAttribute('data-palace-id')))
      .toEqual(['1', '1', '2', '2', ''])

    expect(palaceAccent(1)).not.toBe(palaceAccent(2))
    expect(palaceAccent(null)).toBe('neutral')

    // Same palace + same tone → identical fill class.
    expect(segments[0].className).toContain(palaceAccentToneClass(1, 'done'))
    expect(segments[1].className).toContain(palaceAccentToneClass(1, 'done'))
    expect(segments[0].className).toBe(segments[1].className)

    // Different palaces keep distinct accents even when tones match.
    expect(segments[3].className).toContain(palaceAccentToneClass(2, 'pending'))
    expect(palaceAccentToneClass(1, 'pending')).not.toBe(palaceAccentToneClass(2, 'pending'))

    // Done no longer forces emerald via palaceDone.
    expect(segments[0].className).not.toContain('bg-emerald-400')
    expect(segments[4].className).toContain(palaceAccentToneClass(null, 'pending'))

    // Faint pending vs solid done must stay a glanceable contrast on 6px ticks.
    expect(palaceAccentToneClass(2, 'pending')).toContain('/25')
    expect(palaceAccentToneClass(1, 'done')).not.toMatch(/\/\d+/)
    expect(segments[3].className).toContain('/25')
    expect(segments[0].className).not.toMatch(/bg-\S+\/\d+/)
  })

  it('speaks the counts the decorative rail cannot', () => {
    renderRail()

    const label = '本轮进度 3/4。点击查看本轮安排'
    const rail = screen.getByTestId('freestyle-progress-rail')
    expect(rail.getAttribute('aria-label')).toBe(label)
    expect(rail.getAttribute('title')).toBeNull()
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('3/4')
    expect(screen.getByTestId('freestyle-progress-hud').getAttribute('title')).toBeNull()
  })

  it('names the hovered tick as that card, not the card currently on screen', () => {
    renderRail()

    expect(screen.getByLabelText('1/4 · 《one》 · 已过')).toBeTruthy()
    expect(screen.getByLabelText('2/4 · 《two》 · 稍后重练')).toBeTruthy()
    expect(screen.getByLabelText('3/4 · 《three》 · 当前')).toBeTruthy()
    expect(screen.getByLabelText('4/4 · 《four》 · 待练')).toBeTruthy()
  })

  it('uses the live feed length including restudy insertions as the HUD denominator', () => {
    renderRail({
      summary: summary({
        retryInserted: 1,
        scheduledBase: 4,
        positionBase: 3,
        passedCount: 1,
      }),
    })

    const label = '本轮进度 3/4。点击查看本轮安排'
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('3/4')
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label')).toBe(label)
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('title')).toBeNull()
    expect(screen.getByTestId('freestyle-progress-hud').getAttribute('title')).toBeNull()
  })

  it('renders retry occurrences as numbered amber circles', () => {
    renderRail({
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, kind: 'source' },
          {
            cardId: 'retry:round-1:one:2',
            tone: 'retry',
            palaceId: 1,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 2,
            sourceCardId: 'one',
            sourceLabel: 'one',
          },
          { cardId: 'two', tone: 'current', palaceId: 1, palaceDone: false, kind: 'source' },
        ],
        retryInserted: 1,
        scheduledBase: 2,
        positionBase: 2,
        position: 2,
        total: 3,
        passedCount: 1,
      }),
    })

    const node = screen.getByTestId('freestyle-progress-retry-node')
    expect(node.textContent).toBe('2')
    expect(node.getAttribute('aria-label')).toBe('2/3 · 重练《one》第 2 次 · 待重练')
    expect(node.getAttribute('title')).toBeNull()
    expect(node.className).toContain('rounded-full')
    expect(node.className).toContain(retryNodeToneClass('retry'))
    expect(screen.getAllByTestId('freestyle-progress-segment')).toHaveLength(2)
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('2/3')
  })

  it('fills a completed retry node solid and leaves an unfinished retry faint', () => {
    renderRail({
      summary: summary({
        segments: [
          {
            cardId: 'retry:round-1:one:1',
            tone: 'done',
            palaceId: 1,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 1,
            sourceCardId: 'one',
            sourceLabel: 'one',
          },
          {
            cardId: 'retry:round-1:two:2',
            tone: 'retry',
            palaceId: 2,
            palaceDone: false,
            kind: 'retry',
            retryAttempt: 2,
            sourceCardId: 'two',
            sourceLabel: 'two',
          },
        ],
        retryInserted: 2,
        scheduledBase: 1,
        positionBase: 1,
        passedCount: 1,
      }),
    })

    const nodes = screen.getAllByTestId('freestyle-progress-retry-node')
    expect(nodes[0].className).toContain(retryNodeToneClass('done'))
    expect(nodes[1].className).toContain(retryNodeToneClass('retry'))
    expect(nodes[0].getAttribute('aria-label')).toBe('1/2 · 重练《one》第 1 次 · 已过')
    expect(nodes[1].getAttribute('aria-label')).toBe('2/2 · 重练《two》第 2 次 · 待重练')
  })

  it('keeps a rated viewing tick taller than other done ticks', () => {
    renderRail({
      summary: summary({
        segments: [
          { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false, viewing: true, kind: 'source', sourceLabel: 'one' },
          { cardId: 'two', tone: 'done', palaceId: 1, palaceDone: false, viewing: false, kind: 'source', sourceLabel: 'two' },
        ],
        position: 1,
        positionBase: 1,
        doneCount: 2,
        passedCount: 2,
      }),
    })

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments[0].getAttribute('data-viewing')).toBe('true')
    expect(segments[0].className).toContain(progressSegmentShapeClass('done', true))
    expect(segments[1].getAttribute('data-viewing')).toBe('false')
    expect(segments[1].className).toContain(progressSegmentShapeClass('done'))
    expect(screen.getByLabelText('1/2 · 《one》 · 当前 · 已过')).toBeTruthy()
  })

  it('opens the round plan from the rail', () => {
    const { onOpenPlan } = renderRail()

    fireEvent.click(screen.getByTestId('freestyle-progress-rail'))
    expect(onOpenPlan).toHaveBeenCalledTimes(1)
  })

  it('renders an empty rail without segments for an empty round', () => {
    renderRail({
      summary: summary({
        segments: [],
        position: 0,
        total: 0,
        doneCount: 0,
        retryCount: 0,
        scheduledBase: 0,
        positionBase: 0,
        retryInserted: 0,
        passedCount: 0,
      }),
    })

    expect(screen.queryAllByTestId('freestyle-progress-segment')).toHaveLength(0)
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label'))
      .toBe('本轮暂无安排。点击查看本轮安排')
    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('title')).toBeNull()
  })

  it('does not show a session timer on the HUD', () => {
    renderRail()
    expect(screen.queryByTestId('freestyle-timer-dot')).toBeNull()
  })
})
