import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { resetAutoSaveCoordinatorForTest } from '@/shared/persistence/autosaveCoordinator'
import {
  readPersistedTimedSessionTestSnapshot,
  TimedSessionTestHarness,
} from '@/shared/hooks/useTimedSession.test-support'

describe('useTimedSession focus rounds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.sessionStorage.clear()
    resetClientPreferenceCacheForTest()
    resetAutoSaveCoordinatorForTest()
  })

  afterEach(() => {
    resetAutoSaveCoordinatorForTest()
    resetClientPreferenceCacheForTest()
    vi.useRealTimers()
  })

  it('persists acknowledged milestones and the next round baseline across remounts', () => {
    const view = render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:focus-round"
      />,
    )

    act(() => {
      vi.advanceTimersByTime(3_200)
      fireEvent.click(screen.getByRole('button', { name: 'acknowledge-interval' }))
      fireEvent.click(screen.getByRole('button', { name: 'acknowledge-goal' }))
    })

    expect(readPersistedTimedSessionTestSnapshot('practice:focus-round')?.focusRound).toMatchObject({
      roundIndex: 1,
      acknowledgedIntervalCount: 1,
      goalCelebrated: true,
    })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'next-round' }))
    })

    const persisted = readPersistedTimedSessionTestSnapshot('practice:focus-round')
    expect(persisted?.focusRound).toMatchObject({
      roundIndex: 2,
      startedAtEffectiveSeconds: 3,
      acknowledgedIntervalCount: 0,
      goalCelebrated: false,
    })

    view.unmount()
    render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:focus-round"
        autoStart={false}
      />,
    )

    expect(screen.getByTestId('focus-round-index').textContent).toBe('2')
    expect(screen.getByTestId('focus-round-start').textContent).toBe('3')
  })

  it('keeps the current focus round through manual pause and resume', () => {
    render(<TimedSessionTestHarness kind="practice" autoPauseMs={60_000} />)

    act(() => {
      vi.advanceTimersByTime(4_100)
      fireEvent.click(screen.getByRole('button', { name: 'next-round' }))
      fireEvent.click(screen.getByRole('button', { name: 'pause' }))
      vi.advanceTimersByTime(10_000)
      fireEvent.click(screen.getByRole('button', { name: 'resume' }))
    })

    expect(screen.getByTestId('focus-round-index').textContent).toBe('2')
    expect(screen.getByTestId('focus-round-start').textContent).toBe('4')
  })

  it('pauses at the total idle timeout and excludes the idle window from study time', () => {
    render(<TimedSessionTestHarness kind="practice" />)

    // The 30s warning grace is inside the 120s idle window, not added after it.
    act(() => {
      vi.advanceTimersByTime(120_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')
    expect(screen.getByTestId('seconds').textContent).toBe('0')
    expect(screen.getByTestId('idle-seconds').textContent).toBe('0')
  })
})
