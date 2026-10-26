import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FreestyleWaitingState } from './FreestyleWaitingState'
import { FreestyleWaitingBanner } from './FreestyleWaitingBanner'

const READY = new Date(2026, 9, 25, 22, 10, 0)

beforeEach(() => {
  vi.useFakeTimers()
  // Ten minutes before the earliest ready instant.
  vi.setSystemTime(new Date(2026, 9, 25, 22, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FreestyleWaitingState', () => {
  it('says how many are waiting, when the first is ready, and that it is not due yet', () => {
    render(<FreestyleWaitingState count={2} readyAt={READY.toISOString()} onRefresh={vi.fn()} />)

    const panel = screen.getByRole('status')
    expect(panel.textContent).toContain('还有 2 张要稍后再看')
    expect(panel.textContent).toContain('最早 22:10 到点')
    expect(panel.textContent).toContain('到点会自动回到队列')
    expect(panel.textContent).toContain('10 分钟后')
  })

  it('reads a naive API instant as UTC, not local wall time', () => {
    // The backend stores naive UTC. Parsing it as local time put the label eight
    // hours off in China while the server still withheld the cards.
    render(<FreestyleWaitingState count={1} readyAt="2026-10-25T14:10:00" onRefresh={vi.fn()} />)
    const expected = new Date('2026-10-25T14:10:00Z')
    const label = `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`
    expect(screen.getByRole('status').textContent).toContain(`最早 ${label}`)
  })

  it('keeps the refresh inert until the server may release the cards', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingState count={2} readyAt={READY.toISOString()} onRefresh={onRefresh} />)

    const button = screen.getByRole('button', { name: /22:10 后可刷新/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('enables the refresh once the instant has passed', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingState count={2} readyAt={READY.toISOString()} onRefresh={onRefresh} />)

    act(() => {
      vi.advanceTimersByTime(11 * 60_000)
    })

    const panel = screen.getByRole('status')
    expect(panel.textContent).toContain('最早 22:10 已到点')
    fireEvent.click(screen.getByRole('button', { name: /现在刷新/ }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('never claims a time it does not know', () => {
    render(<FreestyleWaitingState count={1} readyAt={null} onRefresh={vi.fn()} />)

    const panel = screen.getByRole('status')
    expect(panel.textContent).not.toContain('最早')
    expect(panel.textContent).toContain('到点会自动回到队列')
  })

  it('refreshes now when no wait time is committed', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingState count={1} readyAt={null} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: /现在刷新/ }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('FreestyleWaitingBanner', () => {
  it('counts down instead of offering a press that cannot do anything', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingBanner count={3} readyAt={READY.toISOString()} onRefresh={onRefresh} />)

    const banner = screen.getByTestId('freestyle-waiting-banner')
    expect(banner.textContent).toContain('还有 3 张稍后 · 22:10 到点')
    expect(banner.textContent).toContain('10 分钟后')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers the refresh once the instant has passed', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingBanner count={3} readyAt={READY.toISOString()} onRefresh={onRefresh} />)

    act(() => {
      vi.advanceTimersByTime(11 * 60_000)
    })

    const banner = screen.getByTestId('freestyle-waiting-banner')
    expect(banner.textContent).toContain('还有 3 张稍后 · 已到点')
    fireEvent.click(screen.getByRole('button', { name: '现在刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('offers the refresh when no wait time is known', () => {
    const onRefresh = vi.fn()
    render(<FreestyleWaitingBanner count={1} readyAt={null} onRefresh={onRefresh} />)

    const banner = screen.getByTestId('freestyle-waiting-banner')
    expect(banner.textContent).toContain('还有 1 张稍后')
    fireEvent.click(screen.getByRole('button', { name: '现在刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
