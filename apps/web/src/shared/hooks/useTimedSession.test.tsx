import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimedSession } from '@/shared/hooks/useTimedSession'
import { TIMER_AUTOMATION_STORAGE_KEY } from '@/shared/components/session/timer-automation-config'
import * as sessionRecordModel from '@/entities/session/model'
import {
  clearPendingTimeRecordRecoveriesForTest,
  listPendingTimeRecordRecoveries,
} from '@/entities/session/model'
import {
  flushMicrotasks,
  readPersistedTimedSessionTestSnapshot,
  TimedSessionTestHarness,
} from '@/shared/hooks/useTimedSession.test-support'

describe('useTimedSession automation config', () => {
  const appendTimeRecordSpy = vi.spyOn(sessionRecordModel, 'appendTimeRecord')

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    window.sessionStorage.clear()
    clearPendingTimeRecordRecoveriesForTest()
    if (!('sendBeacon' in navigator)) {
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        writable: true,
        value: vi.fn(),
      })
    }
    appendTimeRecordSpy.mockReset()
    appendTimeRecordSpy.mockResolvedValue(null)
  })

  afterEach(() => {
    delete window.memoryAnkiDesktopTimer
    vi.useRealTimers()
  })

  it('arms palace_edit default inactive auto pause at 20 seconds', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    render(<TimedSessionTestHarness kind="palace_edit" />)

    expect(screen.getByTestId('status').textContent).toBe('running')
    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000)).toBe(true)
  })

  it('treats explicit autoPauseMs overrides as milliseconds', () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')

    render(<TimedSessionTestHarness kind="palace_edit" autoPauseMs={20_000} />)

    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000)).toBe(true)
    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 20_000_000)).toBe(false)
  })

  it('queues a pending recovery record and prefers sendBeacon on pagehide', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    const sendBeaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)

    render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:unload-beacon"
      />,
    )
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(4_200)
      window.dispatchEvent(new Event('pagehide'))
    })

    await flushMicrotasks()

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1)
    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.record).toMatchObject({
      completionMethod: 'left_page',
      effectiveSeconds: 4,
    })
  })

  it('falls back to keepalive fetch when sendBeacon returns false', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false)
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ item: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:unload-keepalive"
      />,
    )
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(2_100)
      window.dispatchEvent(new Event('pagehide'))
    })

    await flushMicrotasks()

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/time-records',
      expect.objectContaining({
        keepalive: true,
        method: 'POST',
      }),
    )
  })

  it('keeps the recovery draft when unload transports are unavailable', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    vi.spyOn(navigator, 'sendBeacon').mockReturnValue(false)
    vi.spyOn(window, 'fetch').mockImplementation(() => {
      throw new Error('fetch unavailable')
    })

    render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:unload-queued"
      />,
    )
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(2_900)
      window.dispatchEvent(new Event('beforeunload'))
    })

    await flushMicrotasks()

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
  })

  it('flushes the active timer when the desktop shell asks before closing', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    const sendBeaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    let desktopFlushHandler: (() => Promise<unknown> | unknown) | null = null
    window.memoryAnkiDesktopTimer = {
      onDesktopFlushRequest: (handler) => {
        desktopFlushHandler = () =>
          handler({
            requestId: 'desktop-close-1',
            reason: 'main_window_close',
            requestedAt: Date.now(),
          })
        return () => {
          desktopFlushHandler = null
        }
      },
    }

    render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:desktop-close"
      />,
    )
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(3_600)
      await desktopFlushHandler?.()
    })

    await flushMicrotasks()

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1)
    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.record).toMatchObject({
      completionMethod: 'left_page',
      effectiveSeconds: 3,
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'leave_scene',
          meta: expect.objectContaining({
            source: 'main_window_close',
          }),
        }),
      ]),
    })
  })

  it('deduplicates desktop flush and pagehide when both fire during shutdown', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    const sendBeaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    let desktopFlushHandler: (() => Promise<unknown> | unknown) | null = null
    window.memoryAnkiDesktopTimer = {
      onDesktopFlushRequest: (handler) => {
        desktopFlushHandler = () =>
          handler({
            requestId: 'desktop-close-2',
            reason: 'app_before_quit',
            requestedAt: Date.now(),
          })
        return () => {
          desktopFlushHandler = null
        }
      },
    }

    render(
      <TimedSessionTestHarness
        kind="practice"
        autoPauseMs={60_000}
        persistKey="practice:desktop-pagehide-dedupe"
      />,
    )
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(4_400)
      const flushPromise = desktopFlushHandler?.()
      window.dispatchEvent(new Event('pagehide'))
      await flushPromise
    })

    await flushMicrotasks()

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1)
    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.record).toMatchObject({
      effectiveSeconds: 4,
    })
  })

  it('saves on desktop flush even when the session has no restore snapshot key', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)
    vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    let desktopFlushHandler: (() => Promise<unknown> | unknown) | null = null
    window.memoryAnkiDesktopTimer = {
      onDesktopFlushRequest: (handler) => {
        desktopFlushHandler = () =>
          handler({
            requestId: 'desktop-close-no-key',
            reason: 'app_before_quit',
            requestedAt: Date.now(),
          })
        return () => {
          desktopFlushHandler = null
        }
      },
    }

    render(<TimedSessionTestHarness kind="review" autoPauseMs={60_000} />)
    await flushMicrotasks()

    await act(async () => {
      vi.advanceTimersByTime(2_100)
      await desktopFlushHandler?.()
    })

    await flushMicrotasks()

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.record).toMatchObject({
      kind: 'review',
      completionMethod: 'left_page',
      effectiveSeconds: 2,
    })
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

    render(<TimedSessionTestHarness kind="practice" />)

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

    render(<TimedSessionTestHarness kind="palace_edit" />)

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

    render(<TimedSessionTestHarness kind="palace_edit" />)

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
      <TimedSessionTestHarness kind="practice" autoPauseMs={60_000} persistKey="practice:restore-test" />,
    )

    act(() => {
      vi.advanceTimersByTime(3_200)
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(listPendingTimeRecordRecoveries()).toHaveLength(1)
    expect(listPendingTimeRecordRecoveries()[0]?.record).toMatchObject({
      completionMethod: 'left_page',
      effectiveSeconds: 3,
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    render(
      <TimedSessionTestHarness
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

    const snapshot = readPersistedTimedSessionTestSnapshot('practice:resume-window')
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
    const snapshot = readPersistedTimedSessionTestSnapshot('practice:scene-toggle')
    expect(snapshot?.resumeDeadlineAt).toBeTruthy()
    expect(snapshot?.sceneSegments).toEqual([
      expect.objectContaining({
        scene: 'practice',
        effectiveSeconds: 2,
      }),
    ])
    expect(appendTimeRecordSpy).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(10_000)
      result.current.setSceneActive(true, { source: 'route_active' })
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(2)
  })

  it('persists an expired suspended session as left_page when another timer enters later', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)

    const { result, unmount } = renderHook(() =>
      useTimedSession({
        kind: 'review',
        title: '过期恢复测试',
        palaceId: 1,
        autoPauseMs: 5_000,
        persistKey: 'review:expired-suspend-save',
      }),
    )

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(2_200)
      result.current.setSceneActive(false, { source: 'route_inactive' })
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '后续场景',
        palaceId: 2,
        autoPauseMs: 60_000,
        persistKey: 'practice:after-expired-review',
      }),
    )

    await vi.waitFor(() => {
      expect(appendTimeRecordSpy).toHaveBeenCalledTimes(1)
    })

    expect(appendTimeRecordSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: 'review',
      title: '过期恢复测试',
      completionMethod: 'left_page',
      effectiveSeconds: 2,
    })
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

  it('adopts another scene suspended snapshot when a new scene enters', async () => {
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

    const { result: nextSceneResult } = renderHook(() =>
      useTimedSession({
        kind: 'review',
        title: '场景 B',
        palaceId: 2,
        autoPauseMs: 60_000,
        persistKey: 'review:scene-b',
      }),
    )

    expect(nextSceneResult.current.status).toBe('running')
    expect(nextSceneResult.current.effectiveSeconds).toBe(1)
    expect(window.sessionStorage.getItem('memory-anki-timed-session:practice:scene-a')).toBeNull()
  })

  it('records scene segments across multiple scene handoffs while keeping one session record', async () => {
    appendTimeRecordSpy.mockImplementation(async (record) => record)

    const firstScene = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '场景 A',
        palaceId: 1,
        autoPauseMs: 60_000,
        persistKey: 'practice:scene-a',
      }),
    )

    act(() => {
      firstScene.result.current.start({ source: 'test' })
      vi.advanceTimersByTime(2_000)
      firstScene.result.current.setSceneActive(false, { source: 'route_inactive' })
    })
    firstScene.unmount()

    const secondScene = renderHook(() =>
      useTimedSession({
        kind: 'review',
        title: '场景 B',
        palaceId: 2,
        autoPauseMs: 60_000,
        persistKey: 'review:scene-b',
      }),
    )

    act(() => {
      vi.advanceTimersByTime(3_000)
      secondScene.result.current.setSceneActive(false, { source: 'route_inactive' })
    })
    secondScene.unmount()

    const thirdScene = renderHook(() =>
      useTimedSession({
        kind: 'practice',
        title: '场景 C',
        palaceId: 3,
        autoPauseMs: 60_000,
        persistKey: 'practice:scene-c',
      }),
    )

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    await act(async () => {
      await thirdScene.result.current.complete('manual_complete', { source: 'test_complete' })
    })

    expect(appendTimeRecordSpy).toHaveBeenCalledTimes(1)
    expect(appendTimeRecordSpy.mock.calls[0]?.[0]).toMatchObject({
      effectiveSeconds: 6,
      sceneSegments: [
        expect.objectContaining({ scene: 'practice', title: '场景 A', effectiveSeconds: 2 }),
        expect.objectContaining({ scene: 'review', title: '场景 B', effectiveSeconds: 3 }),
        expect.objectContaining({ scene: 'practice', title: '场景 C', effectiveSeconds: 1 }),
      ],
    })
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

    render(<TimedSessionTestHarness kind="review" />)

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

    render(<TimedSessionTestHarness kind="review" />)

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

    render(<TimedSessionTestHarness kind="palace_edit" />)

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

    const { rerender } = render(<TimedSessionTestHarness kind="palace_edit" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('paused')

    act(() => {
      screen.getByRole('button', { name: 'edit-op' }).click()
    })

    expect(screen.getByTestId('status').textContent).toBe('running')

    rerender(<TimedSessionTestHarness kind="practice" />)

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

    render(<TimedSessionTestHarness kind="practice" automationScene="english" />)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 9_000)).toBe(true)
  })

  it('can skip persisting completion records while still returning a finished session payload', async () => {
    render(
      <TimedSessionTestHarness
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
