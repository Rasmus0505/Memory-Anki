import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { FreestyleProgressRail } from './FreestyleProgressRail'

function summary(overrides: Partial<FreestyleProgressSummary> = {}): FreestyleProgressSummary {
  return {
    segments: [
      { cardId: 'one', tone: 'done' },
      { cardId: 'two', tone: 'retry' },
      { cardId: 'three', tone: 'current' },
      { cardId: 'four', tone: 'pending' },
    ],
    position: 3,
    total: 4,
    doneCount: 1,
    retryCount: 1,
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

  it('speaks the counts the decorative rail cannot', () => {
    renderRail()

    expect(screen.getByTestId('freestyle-progress-rail').getAttribute('aria-label'))
      .toBe('本轮进度 3/4，已通过 1，待重练 1。点击查看本轮安排')
  })

  it('opens the round plan from the rail', () => {
    const { onOpenPlan } = renderRail()

    fireEvent.click(screen.getByTestId('freestyle-progress-rail'))
    expect(onOpenPlan).toHaveBeenCalledTimes(1)
  })

  it('renders an empty rail without segments for an empty round', () => {
    renderRail({ summary: summary({ segments: [], position: 0, total: 0, doneCount: 0, retryCount: 0 }) })

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

    it('reveals the clock on the first tap without starting or pausing', () => {
      const { onTimerToggle } = renderRail()

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      expect(screen.getByTestId('freestyle-timer-readout').textContent).toBe('12:34')
      expect(onTimerToggle).not.toHaveBeenCalled()
    })

    it('toggles the timer only once the clock is already showing', () => {
      const { onTimerToggle } = renderRail()

      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
      fireEvent.click(screen.getByTestId('freestyle-timer-dot'))
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
  })
})
