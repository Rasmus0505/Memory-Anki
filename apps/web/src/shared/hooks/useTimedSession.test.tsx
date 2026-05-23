import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import { TIMER_AUTOMATION_STORAGE_KEY } from '@/shared/components/session/timer-automation-config'

function TestHarness({ kind }: { kind: 'palace_edit' | 'practice' | 'review' }) {
  const timer = useTimedSession({
    kind,
    title: '测试',
    palaceId: 1,
  })

  React.useEffect(() => {
    timer.start({ source: 'test' })
  }, [timer])

  return (
    <div>
      <div data-testid="status">{timer.status}</div>
      <div data-testid="pause-count">{timer.pauseCount}</div>
      <div data-testid="seconds">{timer.effectiveSeconds}</div>
    </div>
  )
}

describe('useTimedSession automation config', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms palace_edit default inactive auto pause at 20 seconds', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    render(<TestHarness kind="palace_edit" />)

    expect(screen.getByTestId('status').textContent).toBe('running')
    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000)).toBe(true)
  })

  it('arms overridden local config for practice hidden pause', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        practice: {
          inactiveAutoPauseSeconds: 5,
          hiddenAutoPauseSeconds: 7,
          autoPauseRollbackSeconds: 8,
        },
      }),
    )

    render(<TestHarness kind="practice" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(screen.getByTestId('status').textContent).toBe('running')
    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 7_000)).toBe(true)
  })
})
