import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/session/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/session/public')>()
  return {
    ...actual,
    AppDwellSession: () => null,
  }
})

import {
  GlobalTimerProvider,
  useGlobalTimerRegistration,
} from '@/shared/components/session/GlobalTimerProvider'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  saveTimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { TIMER_OVERLAY_LAYOUT_STORAGE_KEY } from '@/shared/components/session/timer-overlay-layout'
import { resetTimedSessionStoresForTests } from '@/modules/session/public'
import { resetClientPreferenceCacheForTest } from '@/shared/preferences/clientPreferences'
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
    <MemoryRouter>
      <GlobalTimerProvider>
        {timer ? <Probe timer={timer} /> : null}
      </GlobalTimerProvider>
    </MemoryRouter>,
  )
}

describe('GlobalTimerProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetClientPreferenceCacheForTest()
    resetTimedSessionStoresForTests()
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

  it('keeps the floating timer off until the setting is enabled', () => {
    renderProvider()
    expect(document.querySelector('[data-timer-overlay-root]')).toBeNull()

    act(() => {
      saveTimerAutomationConfig({
        ...DEFAULT_TIMER_AUTOMATION_CONFIG,
        showFloatingTimer: true,
      })
    })
    expect(document.querySelector('[data-timer-overlay-root]')).toBeTruthy()
  })

  it('restores a previously hidden overlay when the setting is turned on', () => {
    window.localStorage.setItem(
      TIMER_OVERLAY_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        x: 24,
        y: 96,
        width: 320,
        height: 208,
        collapsed: false,
        hidden: true,
      }),
    )
    renderProvider()
    act(() => {
      saveTimerAutomationConfig({
        ...DEFAULT_TIMER_AUTOMATION_CONFIG,
        showFloatingTimer: true,
      })
    })
    expect(screen.queryByRole('button', { name: '显示悬浮计时器' })).toBeNull()
    expect(screen.getByText('计时器 待开始')).toBeTruthy()
  })

  it('asks the desktop overlay to follow the floating-timer setting', () => {
    const sendTimerCommand = vi.fn()
    window.memoryAnkiDesktopTimer = { sendTimerCommand } satisfies DesktopTimerBridge
    renderProvider()
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'closeOverlay' })

    act(() => {
      saveTimerAutomationConfig({
        ...DEFAULT_TIMER_AUTOMATION_CONFIG,
        showFloatingTimer: true,
      })
    })
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'showOverlay' })
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
