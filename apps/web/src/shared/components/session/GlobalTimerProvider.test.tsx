import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GlobalTimerProvider,
  useGlobalTimerRegistration,
} from '@/shared/components/session/GlobalTimerProvider'
import type { TimerFocusScene } from '@/shared/components/session/timer-scenes'
import type {
  DesktopTimerBridge,
  UnifiedTimerCommand,
} from '@/shared/components/session/desktopTimerBridge'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

function createTimer(
  overrides: Partial<TimedSessionController> & Pick<TimedSessionController, 'sessionId'>,
): TimedSessionController {
  return {
    sessionId: overrides.sessionId,
    sessionKey: overrides.sessionKey ?? overrides.sessionId,
    effectiveSeconds: overrides.effectiveSeconds ?? 0,
    pauseCount: 0,
    status: overrides.status ?? 'idle',
    pauseReason: null,
    startedAt: overrides.startedAt ?? null,
    glowState: overrides.glowState ?? 'idle',
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSceneActive: vi.fn(),
    leaveScene: vi.fn(async () => null),
    logEvent: vi.fn(),
    getEffectiveSeconds: vi.fn(() => overrides.effectiveSeconds ?? 0),
    complete: vi.fn(async () => null),
    reset: vi.fn(),
    ...overrides,
  }
}

function Probe({
  timer,
  scene = 'freestyle',
  title = '随心模式',
  isRouteActive = true,
}: {
  timer: TimedSessionController
  scene?: TimerFocusScene
  title?: string
  isRouteActive?: boolean
}) {
  const registered = useGlobalTimerRegistration({
    timer,
    scene,
    title,
    isRouteActive,
    becameActiveAt: 1,
  })
  return <div data-testid="registered-status">{registered.status}</div>
}

function renderProvider(timer?: TimedSessionController) {
  return render(
    <GlobalTimerProvider>
      {timer ? <Probe timer={timer} /> : null}
    </GlobalTimerProvider>,
  )
}

describe('GlobalTimerProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete window.memoryAnkiDesktopTimer
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not turn ordinary page clicks into activity', () => {
    const timer = createTimer({ sessionId: 'click-test', status: 'running' })
    renderProvider(timer)
    render(<button type="button">普通点击</button>)
    fireEvent.click(screen.getByRole('button', { name: '普通点击' }))
    expect(timer.pause).not.toHaveBeenCalled()
  })

  it('publishes one study snapshot with start/pause/resume actions', () => {
    const publishTimerSnapshot = vi.fn()
    window.memoryAnkiDesktopTimer = { publishTimerSnapshot } satisfies DesktopTimerBridge
    renderProvider(createTimer({ sessionId: 'snapshot-test', status: 'running', effectiveSeconds: 65 }))
    expect(publishTimerSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'study',
        status: 'running',
        displaySeconds: 65,
        availableActions: ['pause'],
      }),
    )
  })

  it('routes only pause and resume commands to the active timer', () => {
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    const pause = vi.fn()
    const resume = vi.fn()
    const timer = createTimer({ sessionId: 'command-test', status: 'running', pause, resume })
    window.memoryAnkiDesktopTimer = {
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge
    renderProvider(timer)
    act(() => commandHandler?.({ type: 'pause' }))
    expect(pause).toHaveBeenCalledWith({ source: 'global_floating_timer' })
    timer.status = 'paused'
    act(() => commandHandler?.({ type: 'resume' }))
    expect(resume).toHaveBeenCalledWith({ source: 'global_floating_timer' })
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('ignores closeOverlay without pausing or completing the active timer', () => {
    let commandHandler: ((command: UnifiedTimerCommand) => void) | null = null
    const pause = vi.fn()
    const complete = vi.fn(async () => null)
    const timer = createTimer({
      sessionId: 'close-overlay-test',
      status: 'running',
      pause,
      complete,
    })
    window.memoryAnkiDesktopTimer = {
      onTimerCommand: (handler) => {
        commandHandler = handler
        return () => {
          commandHandler = null
        }
      },
    } satisfies DesktopTimerBridge
    renderProvider(timer)
    act(() => commandHandler?.({ type: 'closeOverlay' }))
    expect(pause).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })
})
