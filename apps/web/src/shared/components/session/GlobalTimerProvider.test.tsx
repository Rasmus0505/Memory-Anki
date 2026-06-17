import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GlobalTimerProvider,
  calculateResizedTimerOverlayLayout,
  useGlobalTimerRegistration,
} from '@/shared/components/session/GlobalTimerProvider'
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
}: {
  timer: TimedSessionController
  scene: TimerFocusScene
  title: string
  isRouteActive: boolean
  becameActiveAt: number
}) {
  useGlobalTimerRegistration({
    scene,
    title,
    timer,
    isRouteActive,
    becameActiveAt,
  })

  return null
}

function renderOverlay(probes: React.ReactNode) {
  return render(<GlobalTimerProvider>{probes}</GlobalTimerProvider>)
}

describe('GlobalTimerProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
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
      feedbackIntensity: 'extreme',
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
