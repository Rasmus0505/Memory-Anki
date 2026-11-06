import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FreestyleRoundWaiting } from './FreestyleRoundWaiting'

const READY = new Date(2026, 9, 25, 22, 10, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 25, 22, 8, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

function renderWaiting(overrides: Partial<Parameters<typeof FreestyleRoundWaiting>[0]> = {}) {
  const props = {
    count: 2,
    readyAt: READY.toISOString(),
    ratedCount: 36,
    onBack: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
  render(<FreestyleRoundWaiting {...props} />)
  return props
}

describe('FreestyleRoundWaiting', () => {
  it('states the owed re-checks and when they come back instead of declaring the round done', () => {
    renderWaiting()
    const panel = screen.getByTestId('freestyle-round-waiting')
    expect(panel.textContent).toContain('还有 2 张重练')
    expect(screen.getByTestId('freestyle-round-waiting-when').textContent).toContain('22:10 到点')
    expect(panel.textContent).toContain('2 分钟后')
    expect(panel.textContent).toContain('到点自动回到队列')
    // The achievement is kept, but nothing on the page says the round is over.
    expect(panel.textContent).toContain('本轮已评分 36 个单元')
    expect(panel.textContent).not.toContain('本轮完成')
    expect(panel.textContent).not.toContain('结算')
  })

  it('waits by going back to the feed, and names the cost of stopping', () => {
    const { onBack, onStop } = renderWaiting()
    expect(screen.getByTestId('freestyle-round-waiting').textContent)
      .toContain('这些重练今天不再安排')

    fireEvent.click(screen.getByRole('button', { name: '回去等它们' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onStop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '今天到此为止' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('reports the instant as reached once the wait is over', () => {
    renderWaiting()
    act(() => {
      vi.advanceTimersByTime(3 * 60_000)
    })
    expect(screen.getByTestId('freestyle-round-waiting-when').textContent).toContain('已到点')
  })

  it('never invents a time it does not know', () => {
    renderWaiting({ readyAt: null })
    const when = screen.getByTestId('freestyle-round-waiting-when').textContent
    expect(when).toContain('稍后自动回到队列')
    expect(when).not.toContain('到点 ·')
  })
})
