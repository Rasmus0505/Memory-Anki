import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleWaitingState } from './FreestyleWaitingState'
import { FreestyleWaitingBanner } from './FreestyleWaitingBanner'

describe('FreestyleWaitingState', () => {
  it('says how many are waiting and when the first is ready', () => {
    const ready = new Date(2026, 9, 25, 22, 10, 0)
    render(<FreestyleWaitingState count={2} readyAt={ready.toISOString()} onRefresh={vi.fn()} />)

    const panel = screen.getByRole('status')
    expect(panel.textContent).toContain('还有 2 张要稍后再看')
    expect(panel.textContent).toContain('最早 22:10 到点')
    expect(panel.textContent).toContain('到点会自动回到队列')
  })

  it('never claims a time it does not know', () => {
    render(<FreestyleWaitingState count={1} readyAt={null} onRefresh={vi.fn()} />)

    const panel = screen.getByRole('status')
    expect(panel.textContent).not.toContain('最早')
    expect(panel.textContent).toContain('到点会自动回到队列')
  })

  it('refreshes now when asked', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingState count={1} readyAt={null} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: /现在刷新/ }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('FreestyleWaitingBanner', () => {
  it('summarises the wait on one line and can refresh', () => {
    const onRefresh = vi.fn()
    const ready = new Date(2026, 9, 25, 22, 10, 0)
    render(<FreestyleWaitingBanner count={3} readyAt={ready.toISOString()} onRefresh={onRefresh} />)

    const banner = screen.getByTestId('freestyle-waiting-banner')
    expect(banner.textContent).toContain('还有 3 张稍后 · 最早 22:10 到点')
    fireEvent.click(screen.getByRole('button', { name: '现在刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
