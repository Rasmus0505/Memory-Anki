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

function readPersistedSnapshot(persistKey: string) {
  const raw = window.sessionStorage.getItem(`memory-anki-timed-session:${persistKey}`)
  return raw ? JSON.parse(raw) as { recordId?: string | null; resumeDeadlineAt?: string | null } : null
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

  it('persists running sessions as resumable snapshots on pagehide without counting time away', () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    const { unmount } = render(
      <TestHarness kind="practice" autoPauseMs={60_000} persistKey="practice:restore-test" />,
    )

    act(() => {
      vi.advanceTimersByTime(3_200)
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(appendTimeRecordSpy).toHaveBeenCalledTimes(1)
    expect(appendTimeRecordSpy.mock.calls[0]?.[0]).toMatchObject({
      completionMethod: 'left_page',
      effectiveSeconds: 3,
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

    expect(screen.getByTestId('status').textContent).toBe('running')
    expect(screen.getByTestId('seconds').textContent).toBe('3')
  })

  it('resumes the same record id within the resume window and overwrites the final completion method', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)

    const { result, unmount } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 60_000,
        persistKey: 'practice:resume-window',
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(2_400)
    })

    await act(async () => {
      await result.current.leaveScene({ source: 'route_leave' })
    })

    const snapshot = readPersistedSnapshot('practice:resume-window')
    const firstRecord = appendTimeRecordSpy.mock.calls[0]?.[0]

    expect(firstRecord).toMatchObject({
      completionMethod: 'left_page',
      effectiveSeconds: 2,
    })
    expect(snapshot?.recordId).toBe(firstRecord?.id)
    expect(snapshot?.resumeDeadlineAt).toBeTruthy()

    unmount()

    act(() => {
      vi.advanceTimersByTime(15_000)
    })

    const { result: resumedResult } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 60_000,
        persistKey: 'practice:resume-window',
      }),
    )

    expect(resumedResult.current.status).toBe('running')
    expect(resumedResult.current.effectiveSeconds).toBe(2)

    await act(async () => {
      await resumedResult.current.complete('manual_complete', { source: 'test_complete' })
    })

    expect(appendTimeRecordSpy).toHaveBeenCalledTimes(2)
    expect(appendTimeRecordSpy.mock.calls[1]?.[0]).toMatchObject({
      id: firstRecord?.id,
      startedAt: firstRecord?.startedAt,
      completionMethod: 'manual_complete',
      effectiveSeconds: 2,
    })
  })

  it('can suspend and resume the active scene without relying on unmount', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)

    const { result } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 60_000,
        persistKey: 'practice:scene-toggle',
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(2_000)
      result.current.setSceneActive(false, { source: 'route_inactive' })
    })

    expect(result.current.status).toBe('paused')
    expect(readPersistedSnapshot('practice:scene-toggle')?.resumeDeadlineAt).toBeTruthy()
    expect(appendTimeRecordSpy).toHaveBeenCalledTimes(1)
    expect(appendTimeRecordSpy.mock.calls[0]?.[0]).toMatchObject({
      completionMethod: 'left_page',
      effectiveSeconds: 2,
    })

    act(() => {
      vi.advanceTimersByTime(10_000)
      result.current.setSceneActive(true, { source: 'route_active' })
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(2)
  })

  it('does not count time away while a scene is inactive', () => {
    const { result } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 60_000,
        persistKey: 'practice:scene-pause',
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(3_000)
      result.current.setSceneActive(false, { source: 'route_inactive' })
      vi.advanceTimersByTime(20_000)
      result.current.setSceneActive(true, { source: 'route_active' })
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(3)
  })

  it('drops expired suspended snapshots instead of resuming them', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)

    const { result, unmount } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 5_000,
        persistKey: 'practice:expired-window',
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(2_000)
    })

    await act(async () => {
      await result.current.leaveScene({ source: 'route_leave' })
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    const { result: resumedResult } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '测试',
        palaceId: 1,
        autoPauseMs: 5_000,
        persistKey: 'practice:expired-window',
      }),
    )

    expect(resumedResult.current.status).toBe('idle')
    expect(window.sessionStorage.getItem('memory-anki-timed-session:practice:expired-window')).toBeNull()
    expect(appendTimeRecordSpy).toHaveBeenCalledTimes(1)
  })

  it('clears another scene suspended snapshot when a new scene enters', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)

    const { result, unmount } = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '场景 A',
        palaceId: 1,
        autoPauseMs: 60_000,
        persistKey: 'practice:scene-a',
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(1_000)
    })

    await act(async () => {
      await result.current.leaveScene({ source: 'route_leave' })
    })

    unmount()

    expect(window.sessionStorage.getItem('memory-anki-timed-session:practice:scene-a')).toBeTruthy()

    renderHook(() =>
      useTimedSession({
        kind: 'review',
        title: '场景 B',
        palaceId: 2,
        autoPauseMs: 60_000,
        persistKey: 'review:scene-b',
      }),
    )

    expect(window.sessionStorage.getItem('memory-anki-timed-session:practice:scene-a')).toBeNull()
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
