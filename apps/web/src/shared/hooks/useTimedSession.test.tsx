import * as React from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as sessionRecordsStore from '@/modules/session/domain/session-entity/model/session-records-store'
import { resetAutoSaveCoordinatorForTest } from '@/shared/persistence/autosaveCoordinator'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { buildTimedSessionStorageKey } from '@/shared/hooks/timedSessionStorage'
import { useTimedSession } from '@/shared/hooks/useTimedSession'

let testKey = 0

function nextSessionKey() {
  testKey += 1
  return `test-session:${testKey}`
}

function createOptions(sessionKey = nextSessionKey()) {
  return {
    sessionKey,
    kind: 'practice' as const,
    title: '测试计时',
    palaceId: null,
  }
}

function useTestTimedSession(sessionKey?: string) {
  const options = React.useMemo(() => createOptions(sessionKey), [sessionKey])
  return useTimedSession(options)
}

describe('useTimedSession foreground clock', () => {
  const persistSpy = vi.spyOn(sessionRecordsStore, 'persistStudySessionRecord')

  beforeEach(() => {
    vi.useFakeTimers()
    // Flush the zero-delay finalizers scheduled by the previous test's unmount
    // before resetting the persistence spy for this test.
    vi.advanceTimersByTime(0)
    window.localStorage.clear()
    window.sessionStorage.clear()
    resetClientPreferenceCacheForTest()
    resetAutoSaveCoordinatorForTest()
    persistSpy.mockReset()
    persistSpy.mockImplementation(async (record) => record)
    window.dispatchEvent(new Event('focus'))
  })

  afterEach(() => {
    window.dispatchEvent(new Event('focus'))
    resetAutoSaveCoordinatorForTest()
    resetClientPreferenceCacheForTest()
    vi.useRealTimers()
  })

  it('starts idle and only begins after an explicit start', () => {
    const { result } = renderHook(() => useTestTimedSession())

    expect(result.current.status).toBe('idle')
    expect(result.current.effectiveSeconds).toBe(0)

    act(() => {
      result.current.start({ source: 'test' })
      vi.advanceTimersByTime(2_200)
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(2)
  })

  it('freezes a manual pause and resumes only after an explicit resume', () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_600)
      result.current.pause({ source: 'manual' })
    })

    const pausedSeconds = result.current.effectiveSeconds
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('manual')

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(result.current.effectiveSeconds).toBe(pausedSeconds)

    act(() => {
      result.current.resume({ source: 'manual' })
      vi.advanceTimersByTime(1_200)
    })
    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(pausedSeconds + 1)
  })

  it('pauses immediately on blur and automatically resumes only that system pause', () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_100)
      window.dispatchEvent(new Event('blur'))
    })

    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('window_blur')
    const pausedSeconds = result.current.effectiveSeconds

    act(() => {
      vi.advanceTimersByTime(10_000)
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(1_100)
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(pausedSeconds + 1)
  })

  it('pauses immediately on visibility hidden and resumes when visible', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_100)
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('document_hidden')
    const pausedSeconds = result.current.effectiveSeconds

    act(() => {
      vi.advanceTimersByTime(10_000)
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(1_100)
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(pausedSeconds + 1)
    visibility.mockRestore()
  })

  it('does not resume a manual pause after focus, navigation, or activity events', () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(1_100)
      result.current.pause()
      result.current.setSceneActive(false, { source: 'route_inactive' })
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('manual')
  })

  it('makes repeated blur/focus events idempotent', () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(1_100)
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(result.current.pauseCount).toBe(1)
    expect(result.current.status).toBe('running')
  })

  it('does not create duplicate tickers under StrictMode', () => {
    const sessionKey = nextSessionKey()
    function StrictModeTimer() {
      const timer = useTestTimedSession(sessionKey)
      React.useEffect(() => {
        timer.start({ source: 'strict-mode-test' })
      }, [timer])
      return <div data-testid="strict-seconds">{timer.effectiveSeconds}</div>
    }

    const view = render(
      <React.StrictMode>
        <StrictModeTimer />
      </React.StrictMode>,
    )

    act(() => vi.advanceTimersByTime(2_200))
    expect(screen.getByTestId('strict-seconds').textContent).toBe('2')
    view.unmount()
  })

  it('restores an old snapshot as paused without adding offline time', () => {
    const sessionKey = nextSessionKey()
    const startedAt = new Date(Date.now() - 60_000).toISOString()
    window.sessionStorage.setItem(
      buildTimedSessionStorageKey(sessionKey),
      JSON.stringify({
        version: 1,
        kind: 'practice',
        palaceId: null,
        sourceKind: null,
        englishCourseId: null,
        title: '旧快照',
        effectiveSeconds: 7,
        pauseCount: 1,
        status: 'running',
        startedAt,
        durationEdited: false,
        events: [{ type: 'start', at: startedAt }],
        persistedAt: new Date(Date.now() - 30_000).toISOString(),
      }),
    )

    const { result } = renderHook(() => useTestTimedSession(sessionKey))
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('restored')
    expect(result.current.effectiveSeconds).toBe(7)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(result.current.effectiveSeconds).toBe(7)

    act(() => {
      result.current.resume()
      vi.advanceTimersByTime(1_100)
    })
    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(8)
  })

  it('writes one final record when completion and leave are repeated', async () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_100)
    })

    let firstRecord: Awaited<ReturnType<typeof result.current.leaveScene>>
    await act(async () => {
      firstRecord = await result.current.leaveScene({ source: 'route_leave' })
      await result.current.complete('manual_complete', { source: 'duplicate_complete' })
    })

    expect(firstRecord!).toMatchObject({ completionMethod: 'left_page', effectiveSeconds: 2 })
    expect(result.current.status).toBe('completed')
    expect(persistSpy).toHaveBeenCalledTimes(1)
  })

  it('does not persist ordinary ticks, pause, or resume', async () => {
    const sessionKey = nextSessionKey()
    const { result } = renderHook(() => useTestTimedSession(sessionKey))

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_100)
      result.current.pause()
      result.current.resume()
      vi.advanceTimersByTime(1_100)
    })
    expect(persistSpy.mock.calls.filter(([record]) => record.sessionKey === sessionKey)).toHaveLength(0)

    await act(async () => {
      await result.current.complete('manual_complete')
    })
    expect(persistSpy.mock.calls.filter(([record]) => record.sessionKey === sessionKey)).toHaveLength(1)
  })
})
