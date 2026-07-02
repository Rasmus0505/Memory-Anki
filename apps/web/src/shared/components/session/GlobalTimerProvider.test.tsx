import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GlobalTimerProvider,
  useGlobalTimerRegistration,
} from '@/shared/components/session/GlobalTimerProvider'
import {
  calculateResizedTimerOverlayLayout,
  createTimerOverlaySizeTokens,
} from '@/shared/components/session/globalTimerModel'
import type { TimerFocusScene } from '@/shared/components/session/timer-focus-config'
import {
  TIMER_FOCUS_STORAGE_KEY,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  TIMER_OVERLAY_MIN_HEIGHT,
  TIMER_OVERLAY_MIN_WIDTH,
} from '@/shared/components/session/timer-overlay-layout'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import type { DesktopTimerBridge, UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import type { UnifiedTimerCommand } from '@/shared/components/session/desktopTimerBridge'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'

const emitTimerCelebration = vi.fn()

vi.mock('@/shared/components/session/timer-celebration', () => ({
  emitTimerCelebration: (...args: unknown[]) => emitTimerCelebration(...args),
}))

vi.mock('@/shared/components/mindmap-host/useMindMapFeedback', () => ({
  useMindMapFeedbackSettings: () => ({
    mode: 'immersive',
    soundEnabled: true,
    volume: 1,
  }),
}))

function createTimer(
  overrides: Partial<TimedSessionController> & Pick<TimedSessionController, 'sessionId'>,
): TimedSessionController {
  return {
    sessionId: overrides.sessionId,
    effectiveSeconds: overrides.effectiveSeconds ?? 0,
    idleSeconds: overrides.idleSeconds ?? 0,
    pauseCount: overrides.pauseCount ?? 0,
    status: overrides.status ?? 'idle',
    startedAt: overrides.startedAt ?? null,
    durationEdited: overrides.durationEdited ?? false,
    glowState: overrides.glowState ?? 'idle',
    start: overrides.start ?? vi.fn(),
    pause: overrides.pause ?? vi.fn(),
    resume: overrides.resume ?? vi.fn(),
    setSceneActive: overrides.setSceneActive ?? vi.fn(),
    leaveScene: overrides.leaveScene ?? vi.fn(async () => null),
    registerActivity: overrides.registerActivity ?? vi.fn(),
    logEvent: overrides.logEvent ?? vi.fn(),
    adjustDuration: overrides.adjustDuration ?? vi.fn(),
    complete: overrides.complete ?? vi.fn(async () => null),
    reset: overrides.reset ?? vi.fn(),
  }
}

function RegistrationProbe({
  timer,
  scene,
  title,
  isRouteActive,
  becameActiveAt,
  onRegistered,
}: {
  timer: TimedSessionController
  scene: TimerFocusScene
  title: string
  isRouteActive: boolean
  becameActiveAt: number
  onRegistered?: (timer: TimedSessionController) => void
}) {
  const registeredTimer = useGlobalTimerRegistration({
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
  })

  React.useEffect(() => {
    onRegistered?.(registeredTimer)
  }, [onRegistered, registeredTimer])

  return null
}

function renderOverlay(probes: React.ReactNode) {
  return render(<GlobalTimerProvider>{probes}</GlobalTimerProvider>)
}

describe('GlobalTimerProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    delete window.memoryAnkiDesktopTimer
    emitTimerCelebration.mockReset()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    })
  })

  afterEach(() => {
    cleanup()
    resetClientPreferenceCacheForTest()
  })

  it('prefers the active route running session over background sessions', () => {
    renderOverlay(
      <>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'practice-running',
            effectiveSeconds: 80,
            status: 'running',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="practice"
          title="后台练习"
          isRouteActive={false}
          becameActiveAt={100}
        />
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'review-running',
            effectiveSeconds: 10,
            status: 'running',
            startedAt: '2026-06-17T10:01:00',
          })}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={200}
        />
      </>,
    )

    expect(screen.getByText('复习')).toBeTruthy()
    expect(screen.getByText('当前复习')).toBeTruthy()
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
  })

  it('falls back to the most recent started session before an active idle session', () => {
    renderOverlay(
      <>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'paused-practice',
            effectiveSeconds: 120,
            status: 'paused',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="practice"
          title="后台可继续练习"
          isRouteActive={false}
          becameActiveAt={150}
        />
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'idle-review',
            effectiveSeconds: 0,
            status: 'idle',
            startedAt: null,
          })}
          scene="review"
          title="当前页 idle 会话"
          isRouteActive
          becameActiveAt={200}
        />
      </>,
    )

    expect(screen.getByText('后台可继续练习')).toBeTruthy()
    expect(screen.getByRole('button', { name: '继续' })).toBeTruthy()
  })

  it('shows the full idle panel when there is no active session', () => {
    renderOverlay(null)

    expect(screen.getByText('计时器')).toBeTruthy()
    expect(screen.getByText('待开始')).toBeTruthy()
    expect(screen.getByText('当前无学习会话')).toBeTruthy()
    expect(screen.getByText('25:00/25:00 1.00')).toBeTruthy()
    expect(screen.getByRole('button', { name: '进入学习页后开始' }).hasAttribute('disabled')).toBe(true)
  })

  it('does not render the in-page timer overlay in the desktop main window but still publishes snapshots', () => {
    const publishTimerSnapshot = vi.fn()
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    expect(document.querySelector('.memory-anki-global-timer-panel')).toBeNull()
    expect(document.querySelector('.memory-anki-global-timer-capsule')).toBeNull()
    expect(screen.queryByText('当前复习')).toBeNull()
    expect(publishTimerSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'study',
        title: '当前复习',
      }),
    )
  })

  it('cancels a pending break prompt when the desktop main window returns to an active study route', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
      commandHandler?.({ type: 'returnToStudy' })
      vi.advanceTimersByTime(5_000)
    })

    expect(publishTimerSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        title: '当前复习',
      }),
    )
    vi.useRealTimers()
  })

  it('switches a visible break prompt back to study when returning to an active study route', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
      vi.advanceTimersByTime(5_000)
    })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )

    act(() => {
      commandHandler?.({ type: 'returnToStudy' })
    })

    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        title: '当前复习',
      }),
    )
    vi.useRealTimers()
  })

  it('switches a visible break prompt back to study after the route becomes active', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    const timer = createTimer({
      sessionId: 'review-running',
      effectiveSeconds: 10,
      status: 'running',
      startedAt: '2026-06-17T10:00:00',
    })
    const { rerender } = render(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive={false}
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
      vi.advanceTimersByTime(5_000)
      commandHandler?.({ type: 'returnToStudy' })
    })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={200}
        />
      </GlobalTimerProvider>,
    )

    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        title: '当前复习',
      }),
    )
    vi.useRealTimers()
  })

  it('does not prompt for a break after switching away inside the app', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    const timer = createTimer({
      sessionId: 'review-running',
      effectiveSeconds: 10,
      status: 'running',
      startedAt: '2026-06-17T10:00:00',
    })
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
    } satisfies DesktopTimerBridge

    const { rerender } = render(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive={false}
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(publishTimerSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
      }),
    )
    vi.useRealTimers()
  })

  it('prompts for a break after the desktop blur bridge delay', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    const pause = vi.fn()
    let blurHandler: (() => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onMainWindowBlur: (handler) => {
        blurHandler = handler
        return () => {
          blurHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
          pause,
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      blurHandler?.()
    })

    expect(pause).toHaveBeenCalledWith({ source: 'break_guard_prompt' })
    expect(publishTimerSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )
    vi.useRealTimers()
  })

  it('resumes the interrupted study timer when returning before the blur prompt opens', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    const timer = createTimer({
      sessionId: 'review-running',
      effectiveSeconds: 10,
      status: 'running',
      startedAt: '2026-06-17T10:00:00',
      pause,
      resume,
    })

    const { rerender } = render(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
    })
    expect(pause).toHaveBeenCalledWith({ source: 'break_guard_prompt' })

    timer.status = 'paused'
    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      commandHandler?.({ type: 'returnToStudy' })
      vi.advanceTimersByTime(5_000)
    })

    expect(resume).toHaveBeenCalledWith({ source: 'break_guard_prompt_cancel' })
    expect(publishTimerSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )
    vi.useRealTimers()
  })

  it('auto starts a 1 minute break when the visible break prompt is ignored for 5 seconds', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    const pause = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
          pause,
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
      vi.advanceTimersByTime(5_000)
    })

    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(pause).toHaveBeenCalledWith({ source: 'break_guard' })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'running',
        primaryText: '计划 1 分钟',
      }),
    )
    vi.useRealTimers()
  })

  it('pauses the latest active timer when the desktop overlay sends pause', () => {
    const firstPause = vi.fn()
    const latestPause = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    const firstTimer = createTimer({
      sessionId: 'first-running',
      effectiveSeconds: 10,
      status: 'running',
      startedAt: '2026-06-17T10:00:00',
      pause: firstPause,
    })
    const latestTimer = createTimer({
      sessionId: 'latest-running',
      effectiveSeconds: 20,
      status: 'running',
      startedAt: '2026-06-17T10:01:00',
      pause: latestPause,
    })
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: vi.fn(),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    const { rerender } = render(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={firstTimer}
          scene="review"
          title="第一次复习"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={firstTimer}
          scene="review"
          title="第一次复习"
          isRouteActive={false}
          becameActiveAt={100}
        />
        <RegistrationProbe
          timer={latestTimer}
          scene="freestyle"
          title="随心模式"
          isRouteActive
          becameActiveAt={200}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      commandHandler?.({ type: 'pause' })
    })

    expect(firstPause).not.toHaveBeenCalled()
    expect(latestPause).toHaveBeenCalledWith({ source: 'global_floating_timer' })
  })

  it('auto opens /freestyle once when a desktop break first reaches expired', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    const openMainTarget = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      openMainTarget,
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 1 })
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(openMainTarget).toHaveBeenCalledTimes(1)
    expect(openMainTarget).toHaveBeenCalledWith('/freestyle')
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'expired',
      }),
    )
    vi.useRealTimers()
  })

  it('does not repeatedly auto open /freestyle while the same expired break keeps ticking', () => {
    vi.useFakeTimers()
    const openMainTarget = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: vi.fn(),
      openMainTarget,
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 1 })
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(openMainTarget).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('auto opens /freestyle again after snoozing and reaching expired a second time', () => {
    vi.useFakeTimers()
    const openMainTarget = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: vi.fn(),
      openMainTarget,
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 1 })
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    act(() => {
      commandHandler?.({ type: 'snooze', minutes: 1 })
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(openMainTarget).toHaveBeenCalledTimes(2)
    expect(openMainTarget).toHaveBeenNthCalledWith(1, '/freestyle')
    expect(openMainTarget).toHaveBeenNthCalledWith(2, '/freestyle')
    vi.useRealTimers()
  })

  it('does not auto open a page when the bridge has no openMainTarget support', () => {
    vi.useFakeTimers()
    const originalPathname = window.location.pathname
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: vi.fn(),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 1 })
    })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(window.location.pathname).toBe(originalPathname)
    vi.useRealTimers()
  })

  it('switches a break prompt back to study when active study activity is registered', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    const registerActivity = vi.fn()
    let registeredTimer: TimedSessionController | null = null
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
          registerActivity,
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
        onRegistered={(timer) => {
          registeredTimer = timer
        }}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
      vi.advanceTimersByTime(5_000)
    })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'prompting',
      }),
    )

    act(() => {
      registeredTimer?.registerActivity('practice_interaction', { source: 'test_answer' })
    })

    expect(registerActivity).toHaveBeenCalledWith('practice_interaction', { source: 'test_answer' })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        title: '当前复习',
      }),
    )
    vi.useRealTimers()
  })

  it('auto ends an active break when returning to study', () => {
    const publishTimerSnapshot = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
          pause,
          resume,
        })}
        scene="review"
        title="当前复习"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 5 })
    })
    expect(pause).toHaveBeenCalledWith({ source: 'break_guard' })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'running',
      }),
    )

    act(() => {
      commandHandler?.({ type: 'returnToStudy' })
    })

    expect(resume).toHaveBeenCalledWith({ source: 'break_guard_return_to_study' })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        status: 'running',
        title: '当前复习',
      }),
    )
    const logs = JSON.parse(window.localStorage.getItem('memory-anki-break-guard-logs') ?? '[]')
    expect(logs[0]).toEqual(expect.objectContaining({
      endedAt: expect.any(String),
      overtime: false,
      snoozeCount: 0,
    }))
  })

  it('auto ends an active break when study activity resumes', () => {
    const publishTimerSnapshot = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    let registeredTimer: TimedSessionController | null = null
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    const timer = createTimer({
      sessionId: 'review-running',
      effectiveSeconds: 10,
      status: 'running',
      startedAt: '2026-06-17T10:00:00',
      pause,
      resume,
    })
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    const { rerender } = render(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={100}
          onRegistered={(registered) => {
            registeredTimer = registered
          }}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 5 })
    })
    expect(pause).toHaveBeenCalledWith({ source: 'break_guard' })

    timer.status = 'paused'
    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={timer}
          scene="review"
          title="当前复习"
          isRouteActive
          becameActiveAt={100}
          onRegistered={(registered) => {
            registeredTimer = registered
          }}
        />
      </GlobalTimerProvider>,
    )

    act(() => {
      registeredTimer?.registerActivity('practice_interaction', { source: 'test_answer' })
    })

    expect(resume).toHaveBeenCalledWith({ source: 'break_guard_return_to_study' })
    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        status: 'running',
        title: '当前复习',
      }),
    )
    const logs = JSON.parse(window.localStorage.getItem('memory-anki-break-guard-logs') ?? '[]')
    expect(logs[0]).toEqual(expect.objectContaining({
      endedAt: expect.any(String),
      overtime: false,
      snoozeCount: 0,
    }))
  })

  it('treats active freestyle activity as study and leaves the break prompt', () => {
    vi.useFakeTimers()
    const publishTimerSnapshot = vi.fn()
    let registeredTimer: TimedSessionController | null = null
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'freestyle-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="freestyle"
        title="随心模式"
        isRouteActive
        becameActiveAt={100}
        onRegistered={(timer) => {
          registeredTimer = timer
        }}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'promptBreak' })
      vi.advanceTimersByTime(5_000)
    })

    act(() => {
      registeredTimer?.registerActivity('practice_interaction', { source: 'freestyle_choice' })
    })

    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'study',
        title: '随心模式',
      }),
    )
    vi.useRealTimers()
  })

  it('does not auto end a break when returning to a non-active study route', () => {
    const publishTimerSnapshot = vi.fn()
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    window.memoryAnkiDesktopTimer = {
      publishTimerSnapshot: (snapshot: UnifiedTimerSnapshot) => publishTimerSnapshot(snapshot),
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 10,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="后台复习"
        isRouteActive={false}
        becameActiveAt={100}
      />,
    )

    act(() => {
      commandHandler?.({ type: 'startBreak', minutes: 5 })
      commandHandler?.({ type: 'returnToStudy' })
    })

    expect(publishTimerSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'break',
        status: 'running',
      }),
    )
  })

  it('shows a capsule only after manual collapse and keeps it after remount', () => {
    const firstRender = renderOverlay(null)

    fireEvent.click(screen.getByTitle('折叠为胶囊'))
    expect(screen.getByRole('button', { name: '计时器 待开始' })).toBeTruthy()

    firstRender.unmount()
    renderOverlay(null)

    expect(screen.getByRole('button', { name: '计时器 待开始' })).toBeTruthy()
  })

  it('keeps the collapsed capsule available as a draggable surface', () => {
    renderOverlay(null)

    fireEvent.click(screen.getByTitle('折叠为胶囊'))
    const capsule = screen.getByRole('button', { name: '计时器 待开始' })

    expect(capsule.className).toContain('memory-anki-global-timer-capsule')
  })

  it('defaults to a compact capsule for freestyle on narrow screens', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'freestyle-running',
          effectiveSeconds: 5,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="freestyle"
        title="随心模式"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    expect(screen.getByRole('button', { name: /随心模式 00:55/ })).toBeTruthy()
    expect(document.querySelector('.memory-anki-global-timer-panel')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /随心模式 00:55/ }))

    expect(document.querySelector('.memory-anki-global-timer-panel')).toBeTruthy()
  })

  it('opens the timer automation dialog from the top settings button', () => {
    renderOverlay(null)

    fireEvent.click(screen.getByTitle('打开计时器设置'))

    expect(screen.getByRole('heading', { name: '自动化配置' })).toBeTruthy()
  })

  it('clamps oversized stored layout back into the visible viewport', () => {
    window.localStorage.setItem(
      'memory-anki-timer-overlay-layout',
      JSON.stringify({
        x: 99999,
        y: 99999,
        width: 99999,
        height: 99999,
        collapsed: false,
      }),
    )

    renderOverlay(null)

    const layer = document.querySelector('.memory-anki-global-timer-layer') as HTMLDivElement | null
    const panel = document.querySelector('.memory-anki-global-timer-panel') as HTMLDivElement | null

    expect(layer?.style.left).toBe('12px')
    expect(layer?.style.top).toBe('12px')
    expect(panel?.style.width).toBe('1256px')
    expect(panel?.style.height).toBe('876px')
    expect(screen.getByRole('button', { name: '进入学习页后开始' }).hasAttribute('disabled')).toBe(true)
  })

  it('renders window-like resize handles around the timer panel', () => {
    renderOverlay(null)

    expect(screen.getByRole('button', { name: '从上边调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从右边调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从下边调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从左边调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从左上角调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从右上角调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从右下角调整计时器大小' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '从左下角调整计时器大小' })).toBeTruthy()
  })

  it('uses a fixed panel height instead of min-height', () => {
    renderOverlay(null)

    const panel = document.querySelector('.memory-anki-global-timer-panel') as HTMLDivElement | null

    expect(panel?.style.height).toBe('208px')
    expect(panel?.style.minHeight).toBe('')
    expect(panel?.style.getPropertyValue('--timer-digits-font-size')).toBe('64px')
    expect(panel?.style.transform).toBe('')
  })

  it('grows font and control tokens with larger overlay sizes without using transform scaling', () => {
    window.localStorage.setItem(
      'memory-anki-timer-overlay-layout',
      JSON.stringify({
        x: 24,
        y: 96,
        width: 480,
        height: 312,
        collapsed: false,
      }),
    )

    renderOverlay(null)

    const panel = document.querySelector('.memory-anki-global-timer-panel') as HTMLDivElement | null
    const pauseButton = screen.getByRole('button', { name: '进入学习页后开始' }) as HTMLButtonElement

    expect(panel?.style.width).toBe('480px')
    expect(panel?.style.height).toBe('312px')
    expect(panel?.style.getPropertyValue('--timer-digits-font-size')).toBe('96px')
    expect(panel?.style.getPropertyValue('--timer-action-height')).toBe('46px')
    expect(panel?.style.getPropertyValue('--timer-panel-padding')).toBe('18px')
    expect(panel?.style.transform).toBe('')
    expect(pauseButton.style.height).toBe('46px')
  })

  it('creates responsive token values from overlay size with width and height weighting', () => {
    const compact = createTimerOverlaySizeTokens({ width: 220, height: 176 })
    const large = createTimerOverlaySizeTokens({ width: 480, height: 312 })

    expect(compact.widthRatio).toBeLessThan(1)
    expect(compact.heightRatio).toBeLessThan(1)
    expect(compact.panelStyle['--timer-digits-font-size']).toBe('47px')
    expect(compact.panelStyle['--timer-action-height']).toBe('28px')
    expect(large.panelStyle['--timer-digits-font-size']).toBe('96px')
    expect(large.panelStyle['--timer-action-height']).toBe('46px')
    expect(large.panelStyle['--timer-panel-padding']).toBe('18px')
  })

  it('resizes larger from the south-east corner without jumping back to defaults', () => {
    expect(
      calculateResizedTimerOverlayLayout(
        {
          direction: 'se',
          startX: 0,
          startY: 0,
          x: 24,
          y: 96,
          width: 320,
          height: 208,
        },
        40,
        32,
        1280,
        900,
      ),
    ).toEqual({
      x: 24,
      y: 96,
      width: 360,
      height: 240,
    })
  })

  it('resizes larger from the north-west corner while moving the window origin', () => {
    expect(
      calculateResizedTimerOverlayLayout(
        {
          direction: 'nw',
          startX: 0,
          startY: 0,
          x: 24,
          y: 96,
          width: 320,
          height: 208,
        },
        -30,
        -20,
        1280,
        900,
      ),
    ).toEqual({
      x: 12,
      y: 76,
      width: 332,
      height: 228,
    })
  })

  it('shrinks from the east edge down to the configured minimum width', () => {
    expect(
      calculateResizedTimerOverlayLayout(
        {
          direction: 'e',
          startX: 0,
          startY: 0,
          x: 24,
          y: 96,
          width: 320,
          height: 208,
        },
        -500,
        0,
        1280,
        900,
      ),
    ).toMatchObject({
      x: 24,
      y: 96,
      width: TIMER_OVERLAY_MIN_WIDTH,
      height: 208,
    })
  })

  it('shrinks from the south edge down to the configured minimum height', () => {
    expect(
      calculateResizedTimerOverlayLayout(
        {
          direction: 's',
          startX: 0,
          startY: 0,
          x: 24,
          y: 96,
          width: 320,
          height: 208,
        },
        0,
        -500,
        1280,
        900,
      ),
    ).toMatchObject({
      x: 24,
      y: 96,
      width: 320,
      height: TIMER_OVERLAY_MIN_HEIGHT,
    })
  })

  it('clamps oversize resize operations to the viewport instead of resetting layout', () => {
    expect(
      calculateResizedTimerOverlayLayout(
        {
          direction: 'se',
          startX: 0,
          startY: 0,
          x: 24,
          y: 96,
          width: 320,
          height: 208,
        },
        5000,
        5000,
        1280,
        900,
      ),
    ).toEqual({
      x: 24,
      y: 96,
      width: 1244,
      height: 792,
    })
  })

  it('renders the secondary countdown as the primary visual target', () => {
    const focusConfig: TimerFocusConfig = {
      mode: 'global',
      feedbackIntensity: 'cinematic',
      celebration: {
        secondaryInterval: {
          enabled: true,
          soundEnabled: true,
          animationEnabled: true,
          volumeBoost: 1,
          visualPreset: 'auto',
        },
        primaryGoal: {
          enabled: true,
          soundEnabled: true,
          animationEnabled: true,
          volumeBoost: 1,
          visualPreset: 'auto',
        },
      },
      global: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      palace_edit: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      practice: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      quiz: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      review: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      freestyle: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      english: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
      english_reading: {
        primaryMinutes: 25,
        secondaryMinutes: 1,
      },
    }
    window.localStorage.setItem(TIMER_FOCUS_STORAGE_KEY, JSON.stringify(focusConfig))

    renderOverlay(
      <RegistrationProbe
        timer={createTimer({
          sessionId: 'review-running',
          effectiveSeconds: 65,
          idleSeconds: 3,
          status: 'running',
          startedAt: '2026-06-17T10:00:00',
        })}
        scene="review"
        title="复习会话"
        isRouteActive
        becameActiveAt={100}
      />,
    )

    expect(screen.getByText('00:55')).toBeTruthy()
    expect(screen.getByText('01:05/25:00 0.04')).toBeTruthy()
  })

  it('emits secondary and primary celebrations only once per threshold crossing', () => {
    const { rerender } = render(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'review-running',
            effectiveSeconds: 59,
            status: 'running',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="review"
          title="复习会话"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    expect(emitTimerCelebration).not.toHaveBeenCalled()

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'review-running',
            effectiveSeconds: 60,
            status: 'running',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="review"
          title="复习会话"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    expect(emitTimerCelebration).toHaveBeenCalledTimes(1)
    expect(emitTimerCelebration).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'secondary',
        completionCount: 1,
      }),
    )

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'review-running',
            effectiveSeconds: 61,
            status: 'running',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="review"
          title="复习会话"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    expect(emitTimerCelebration).toHaveBeenCalledTimes(1)

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'review-running',
            effectiveSeconds: 1500,
            status: 'running',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="review"
          title="复习会话"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    expect(emitTimerCelebration).toHaveBeenCalledTimes(3)
    expect(emitTimerCelebration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'secondary',
        completionCount: 25,
      }),
    )
    expect(emitTimerCelebration).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        kind: 'primary',
        completionCount: 25,
      }),
    )

    rerender(
      <GlobalTimerProvider>
        <RegistrationProbe
          timer={createTimer({
            sessionId: 'review-running',
            effectiveSeconds: 1501,
            status: 'running',
            startedAt: '2026-06-17T10:00:00',
          })}
          scene="review"
          title="复习会话"
          isRouteActive
          becameActiveAt={100}
        />
      </GlobalTimerProvider>,
    )

    expect(emitTimerCelebration).toHaveBeenCalledTimes(3)
  })
})
