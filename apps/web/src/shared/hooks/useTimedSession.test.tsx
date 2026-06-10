import * as React from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import { TIMER_AUTOMATION_STORAGE_KEY } from '@/shared/components/session/timer-automation-config'
import * as sessionRecordModel from '@/entities/session/model'

interface TestHarnessProps {
  kind: 'palace_edit' | 'practice' | 'review'
  automationScene?: 'palace_edit' | 'practice' | 'review' | 'english'
  autoPauseMs?: number
  hiddenPauseMs?: number
  persistKey?: string | null
  autoStart?: boolean
  persistCompletionRecord?: boolean
}

function TestHarness({
  kind,
  automationScene,
  autoPauseMs,
  hiddenPauseMs,
  persistKey = null,
  autoStart = true,
  persistCompletionRecord = true,
}: TestHarnessProps) {
  const timer = useTimedSession({
    kind,
    title: '测试',
    palaceId: 1,
    automationScene,
    autoPauseMs,
    hiddenPauseMs,
    persistKey,
    persistCompletionRecord,
  })

  React.useEffect(() => {
    if (!autoStart) return
    timer.start({ source: 'test' })
    // Start once so later rerenders don't mask pause/resume behavior under test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  return (
    <div>
      <div data-testid="status">{timer.status}</div>
      <div data-testid="pause-count">{timer.pauseCount}</div>
      <div data-testid="seconds">{timer.effectiveSeconds}</div>
      <button type="button" onClick={() => timer.registerActivity('node_switch', { source: 'test_node_switch' })}>
        node-switch
      </button>
      <button type="button" onClick={() => timer.registerActivity('edit_operation', { source: 'test_edit_operation' })}>
        edit-op
      </button>
      <button type="button" onClick={() => timer.registerActivity('practice_interaction', { source: 'test_practice_interaction' })}>
        practice-op
      </button>
      <button type="button" onClick={() => void timer.complete('manual_complete', { source: 'test_complete' })}>
        complete
      </button>
    </div>
  )
}

describe('useTimedSession automation config', () => {
  const appendTimeRecordSpy = vi.spyOn(sessionRecordModel, 'appendTimeRecord')

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.sessionStorage.clear()
    appendTimeRecordSpy.mockReset()
    appendTimeRecordSpy.mockResolvedValue(null)
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

  it('treats explicit autoPauseMs overrides as milliseconds', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    render(<TestHarness kind="palace_edit" autoPauseMs={20_000} />)

    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000)).toBe(true)
    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000_000)).toBe(false)
  })

  it('arms overridden local config for practice hidden pause', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
        practice: {
          autoStartOnPageEnter: false,
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

  it('auto pauses on inactivity and rolls back effective seconds by config', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
        palace_edit: {
          autoStartOnPageEnter: false,
          inactiveAutoPauseSeconds: 5,
          hiddenAutoPauseSeconds: 15,
          autoPauseRollbackSeconds: 3,
        },
      }),
    )

    render(<TestHarness kind="palace_edit" />)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')
    expect(screen.getByTestId('pause-count').textContent).toBe('1')
    expect(screen.getByTestId('seconds').textContent).toBe('2')
  })

  it('caps inactivity rollback to the actual idle tail instead of wiping active time', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
        palace_edit: {
          autoStartOnPageEnter: false,
          inactiveAutoPauseSeconds: 5,
          hiddenAutoPauseSeconds: 15,
          autoPauseRollbackSeconds: 30,
        },
      }),
    )

    render(<TestHarness kind="palace_edit" />)

    act(() => {
      vi.advanceTimersByTime(4_000)
      screen.getByRole('button', { name: 'edit-op' }).click()
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')
    expect(screen.getByTestId('seconds').textContent).toBe('4')
  })

  it('persists running sessions as paused snapshots on pagehide without counting time away', () => {
    const { unmount } = render(
      <TestHarness kind="practice" autoPauseMs={60_000} persistKey="practice:restore-test" />,
    )

    act(() => {
      vi.advanceTimersByTime(3_200)
      window.dispatchEvent(new Event('pagehide'))
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    render(
      <TestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:restore-test"
        autoStart={false}
      />,
    )

    expect(screen.getByTestId('status').textContent).toBe('paused')
    expect(screen.getByTestId('seconds').textContent).toBe('3')
  })

  it('does not auto resume on focus when window return is disabled', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
      }),
    )

    render(<TestHarness kind="review" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')
  })

  it('auto resumes on focus when window return is enabled', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: true,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
      }),
    )

    render(<TestHarness kind="review" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    expect(screen.getByTestId('status').textContent).toBe('running')
  })

  it('ignores node switch activity when that category is disabled', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: false,
          countPracticeInteractionsAsActivity: false,
        },
      }),
    )

    render(<TestHarness kind="palace_edit" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')

    act(() => {
      screen.getByRole('button', { name: 'node-switch' }).click()
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')
  })

  it('allows edit and practice activity categories to resume when enabled', () => {
    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
      }),
    )

    const { rerender } = render(<TestHarness kind="palace_edit" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')

    act(() => {
      screen.getByRole('button', { name: 'edit-op' }).click()
    })

    expect(screen.getByTestId('status').textContent).toBe('running')

    rerender(<TestHarness kind="practice" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')

    act(() => {
      screen.getByRole('button', { name: 'practice-op' }).click()
    })

    expect(screen.getByTestId('status').textContent).toBe('running')
  })

  it('uses english automation rules while keeping practice session kind', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    window.localStorage.setItem(
      TIMER_AUTOMATION_STORAGE_KEY,
      JSON.stringify({
        actions: {
          autoResumeOnWindowReturn: false,
          countNodeSwitchAsActivity: false,
          countEditOperationsAsActivity: true,
          countPracticeInteractionsAsActivity: true,
        },
        english: {
          autoStartOnPageEnter: true,
          inactiveAutoPauseSeconds: 5,
          hiddenAutoPauseSeconds: 9,
          autoPauseRollbackSeconds: 4,
        },
      }),
    )

    render(<TestHarness kind="practice" automationScene="english" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 9_000)).toBe(true)
  })

  it('can skip persisting completion records while still returning a finished session payload', async () => {
    render(
      <TestHarness
        kind="review"
        autoPauseMs={60_000}
        persistCompletionRecord={false}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    await act(async () => {
      screen.getByRole('button', { name: 'complete' }).click()
    })

    expect(appendTimeRecordSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('status').textContent).toBe('completed')
  })

  it('returns the completed record when persistence fails after the API layer queues it', async () => {
    appendTimeRecordSpy.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() =>
      useTimedSession({
        kind: 'review',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 60_000,
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(3_000)
    })

    let record: Awaited<ReturnType<typeof result.current.complete>> | null = null
    await act(async () => {
      record = await result.current.complete('manual_complete', { source: 'test_complete' })
    })

    expect(appendTimeRecordSpy).toHaveBeenCalledTimes(1)
    expect(record).toMatchObject({
      kind: 'review',
      palaceId: 1,
      title: '测试',
      completionMethod: 'manual_complete',
    })
    expect(record?.id).toBeTruthy()
  })
})
