import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  palaceAccent,
  palaceAccentToneClass,
  type FreestyleProgressSummary,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { FreestyleProgressRail } from './FreestyleProgressRail'

function summary(overrides: Partial<FreestyleProgressSummary> = {}): FreestyleProgressSummary {
  return {
    segments: [
      { cardId: 'one', tone: 'done', palaceId: 1, palaceDone: false },
      { cardId: 'two', tone: 'retry', palaceId: 1, palaceDone: false },
      { cardId: 'three', tone: 'current', palaceId: 2, palaceDone: false },
      { cardId: 'four', tone: 'pending', palaceId: 2, palaceDone: false },
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
  const onTimerToggle = vi.fn()
  const props = {
    summary: summary(),
    timerStatus: 'running' as const,
    effectiveSeconds: 754,
    onOpenPlan,
    onTimerToggle,
    ...overrides,
  }
  render(<FreestyleProgressRail {...props} />)
  return { onOpenPlan, onTimerToggle }
}

describe('FreestyleProgressRail', () => {
  it('draws one segment per card so restudy re-insertion stays visible', () => {
    renderRail()

    const segments = screen.getAllByTestId('freestyle-progress-segment')
    expect(segments).toHaveLength(4)
    expect(segments.map((node) => node.getAttribute('data-tone')))
      .toEqual(['done', 'retry', 'current', 'pending'])
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
  })

  it('speaks the counts the decorative rail cannot', () => {
    renderRail()

    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label'))
      .toBe('本轮进度 3/4，已通过 1。点击查看本轮安排')
    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('3/4 · 过 1')
  })

  it('keeps the planned denominator when restudy insertions lengthen the feed', () => {
    renderRail({
      summary: summary({
        retryInserted: 1,
        scheduledBase: 4,
        positionBase: 3,
        passedCount: 1,
      }),
    })

    expect(screen.getByTestId('freestyle-progress-hud').textContent).toBe('3/4 · 重练 +1 · 过 1')
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
  })

  describe('timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('stays a dot until asked, so seconds stop pulling focus', () => {
      renderRail()

      expect(screen.queryByTestId('freestyle-timer-readout')).toBeNull()
      expect(screen.getByTestId('freestyle-timer-dot').getAttribute('aria-label')).toBe('查看计时')
    })

    it('toggles the timer on the first tap and reveals the clock', () => {
      const { onTimerToggle } = renderRail()

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      expect(screen.getByTestId('freestyle-timer-readout').textContent).toBe('12:34')
      expect(onTimerToggle).toHaveBeenCalledTimes(1)
    })

    it('collapses back to a dot after the peek window', () => {
      renderRail()

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      expect(screen.getByTestId('freestyle-timer-readout')).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(4_100)
      })
      expect(screen.queryByTestId('freestyle-timer-readout')).toBeNull()
    })

    it('offers 开始 rather than a zeroed clock before the timer runs', () => {
      renderRail({ timerStatus: 'idle', effectiveSeconds: 0 })

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      expect(screen.getByTestId('freestyle-timer-readout').textContent).toBe('开始')
    })

    it('marks the dot by timer state', () => {
      renderRail({ timerStatus: 'paused' })

      expect(screen.getByTestId('freestyle-timer-dot').className).toContain('text-amber-200')
    })

    it('shows a completed timer as a frozen duration without toggling it', () => {
      const { onTimerToggle } = renderRail({ timerStatus: 'completed' })

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      expect(screen.getByTestId('freestyle-timer-readout').textContent).toBe('12:34')
      expect(screen.getByTestId('freestyle-timer-dot').getAttribute('aria-label')).toBe('本次计时已完成')

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      expect(onTimerToggle).not.toHaveBeenCalled()
    })
  })
})
