import * as React from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as sessionRecordsStore from '@/modules/session/domain/session-entity/model/session-records-store'
import { resetAutoSaveCoordinatorForTest } from '@/shared/persistence/autosaveCoordinator'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
import { buildTimedSessionStorageKey } from '@/shared/hooks/timedSessionStorage'
import {
  dwellKindToSessionKind,
  resolveDwellFragment,
  resetTimedSessionStoresForTests,
} from '@/modules/session/public'
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
    resetTimedSessionStoresForTests()
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

  it('keeps counting while the window is blurred but still visible', () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_100)
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(1_200)
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(3)
  })

  it('keeps counting after pagehide when the document is still visible', async () => {
    const { result } = renderHook(() => useTimedSession({
      sessionKey: 'dwell:live',
      kind: 'quiz',
      title: '随心',
      palaceId: null,
      persistCompletionRecord: true,
    }))

    act(() => {
      result.current.start({ source: 'dwell_autostart' })
      vi.advanceTimersByTime(2_100)
      window.dispatchEvent(new Event('pagehide'))
      vi.advanceTimersByTime(3_100)
    })

    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(5)

    let record: Awaited<ReturnType<typeof result.current.complete>>
    await act(async () => {
      record = await result.current.complete('manual_complete')
    })
    expect(record!).toMatchObject({
      effectiveSeconds: 5,
      clientSource: 'desktop',
    })
  })

  it('stops immediately when the document hides and does not count the lock-screen gap', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const { result } = renderHook(() => useTimedSession({
      sessionKey: 'dwell:live',
      kind: 'quiz',
      title: '随心',
      palaceId: null,
      persistCompletionRecord: true,
    }))

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(2_100)
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
      vi.advanceTimersByTime(20_000)
    })

    const hiddenSeconds = result.current.effectiveSeconds
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('document_hidden')
    expect(hiddenSeconds).toBe(2)

    act(() => {
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(1_100)
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(result.current.status).toBe('paused')
    expect(result.current.effectiveSeconds).toBe(hiddenSeconds)
    visibility.mockRestore()
  })

  it('pauses when the document hides and does not resume until the next click', () => {
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

    expect(result.current.status).toBe('paused')
    expect(result.current.effectiveSeconds).toBe(pausedSeconds)
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

  it('does not treat repeated blur/focus as pauses', () => {
    const { result } = renderHook(() => useTestTimedSession())

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(1_100)
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(result.current.pauseCount).toBe(0)
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

  it('splits a dwell session after 15 hidden minutes and keeps it inside the window', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    const { result } = renderHook(() => useTimedSession({
      sessionKey: 'dwell:live',
      kind: 'practice',
      title: '洞察',
      palaceId: null,
      persistCompletionRecord: true,
    }))

    act(() => {
      document.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(2_100)
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('document_hidden')
    expect(result.current.effectiveSeconds).toBe(2)

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000)
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.status).toBe('paused')
    expect(result.current.effectiveSeconds).toBe(2)
    act(() => document.dispatchEvent(new Event('pointerdown')))
    expect(result.current.status).toBe('running')

    await act(async () => {
      visibility.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(15 * 60 * 1000 + 1)
      visibility.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(0)
    })

    expect(result.current.status).toBe('idle')
    expect(persistSpy).toHaveBeenCalled()
    act(() => document.dispatchEvent(new Event('pointerdown')))
    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(0)
    visibility.mockRestore()
  })

  it('keeps foreground seconds already counted when one later gap exceeds five seconds', () => {
    const { result } = renderHook(() => useTimedSession({
      sessionKey: 'dwell:live',
      kind: 'quiz',
      title: '随心',
      palaceId: null,
      persistCompletionRecord: true,
    }))

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(8_100)
    })
    expect(result.current.effectiveSeconds).toBe(8)

    act(() => {
      vi.setSystemTime(Date.now() + 30_000)
      result.current.getEffectiveSeconds()
    })
    expect(result.current.effectiveSeconds).toBe(8)

    act(() => {
      result.current.pause()
    })
    expect(result.current.status).toBe('paused')
    expect(result.current.effectiveSeconds).toBe(8)
  })

  it('stops as soon as the learner leaves a learning page and does not count settings', async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => {
        const fragment = resolveDwellFragment(path)
        return useTimedSession({
          sessionKey: 'dwell:live',
          kind: dwellKindToSessionKind(fragment.kind),
          title: fragment.title,
          palaceId: fragment.palaceId,
          automationScene: fragment.scene,
          persistCompletionRecord: true,
          routePath: fragment.routePath,
        })
      },
      { initialProps: { path: '/freestyle' } },
    )

    act(() => {
      document.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(5_100)
      document.dispatchEvent(new Event('pointerdown'))
    })
    const secondsBeforeSettings = result.current.effectiveSeconds
    expect(secondsBeforeSettings).toBeGreaterThan(0)

    act(() => {
      rerender({ path: '/profile/timer' })
      result.current.setSceneActive(false, { source: 'route_inactive' })
      vi.advanceTimersByTime(20 * 60 * 1000)
    })
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('scene_inactive')
    expect(result.current.effectiveSeconds).toBe(secondsBeforeSettings)
    expect(persistSpy.mock.calls.some(([record]) => (
      record.sessionKey?.startsWith('dwell:') && record.completionMethod !== 'saved'
    ))).toBe(false)

    act(() => {
      rerender({ path: '/dashboard' })
      result.current.setSceneActive(false, { source: 'route_inactive' })
      document.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(1_200)
    })
    expect(result.current.status).toBe('paused')
    expect(result.current.effectiveSeconds).toBe(secondsBeforeSettings)

    let record: Awaited<ReturnType<typeof result.current.complete>> = null
    await act(async () => {
      record = await result.current.complete('manual_complete')
    })
    expect(record?.sceneSegments?.some((segment) => (
      segment.title === '设置' || segment.routePath?.startsWith('/profile')
    ))).toBe(false)
    expect(record?.sceneSegments?.some((segment) => segment.title === '随心')).toBe(true)
  })

  it('counts the thinking grace and excludes the idle tail', () => {
    const { result } = renderHook(() => useTimedSession({
      sessionKey: 'dwell:live',
      kind: 'quiz',
      title: '随心',
      palaceId: null,
      persistCompletionRecord: true,
    }))

    act(() => {
      document.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(90_000)
    })
    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBe(90)

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000)
    })
    expect(result.current.status).toBe('paused')
    expect(result.current.pauseReason).toBe('click_idle_timeout')
    expect(result.current.effectiveSeconds).toBe(90)
  })

  it('closes the current record when the learning activity changes', async () => {
    const { result, rerender } = renderHook(
      ({ title, scene }: { title: string; scene: 'freestyle' | 'quiz' }) => useTimedSession({
        sessionKey: 'dwell:live',
        kind: 'quiz',
        title,
        palaceId: null,
        automationScene: scene,
        persistCompletionRecord: true,
        routePath: '/freestyle',
      }),
      { initialProps: { title: '随心', scene: 'freestyle' as const } },
    )

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(5_100)
    })
    expect(persistSpy.mock.calls.filter(([record]) => record.completionMethod !== 'saved')).toHaveLength(0)
    const idBefore = result.current.effectiveSeconds
    expect(idBefore).toBeGreaterThan(0)

    act(() => {
      rerender({ title: '做题', scene: 'quiz' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const sealed = persistSpy.mock.calls
      .map(([record]) => record)
      .filter((record) => record.completionMethod === 'left_page')
    expect(sealed.length).toBeGreaterThanOrEqual(1)
    expect(sealed.at(-1)?.sceneSegments?.some((segment) => segment.title === '随心' || segment.scene === 'freestyle')).toBe(true)
    const sealedId = sealed.at(-1)?.id

    act(() => {
      document.dispatchEvent(new Event('pointerdown'))
      vi.advanceTimersByTime(2_100)
    })
    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBeLessThan(idBefore)
    expect(result.current.effectiveSeconds).toBeGreaterThan(0)

    await act(async () => {
      await result.current.complete('manual_complete')
    })
    const nextRecord = persistSpy.mock.calls.map(([record]) => record).at(-1)
    expect(nextRecord?.id).not.toBe(sealedId)
    expect(nextRecord?.sceneSegments?.some((segment) => segment.scene === 'quiz')).toBe(true)
  })

  it('does not checkpoint a page timer that must not persist', () => {
    const { result, rerender } = renderHook(
      ({ title }: { title: string }) => useTimedSession({
        sessionKey: 'freestyle',
        kind: 'quiz',
        title,
        palaceId: null,
        automationScene: title === '做题' ? 'quiz' : 'freestyle',
        persistCompletionRecord: false,
        routePath: '/freestyle',
      }),
      { initialProps: { title: '随心' } },
    )

    act(() => {
      result.current.start()
      vi.advanceTimersByTime(5_100)
      rerender({ title: '做题' })
      vi.advanceTimersByTime(31_000)
    })

    expect(persistSpy).not.toHaveBeenCalled()
    expect(result.current.status).toBe('running')
    expect(result.current.effectiveSeconds).toBeGreaterThan(30)
  })
})
