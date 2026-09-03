import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import { GlobalTimerFloatingOverlay } from '@/shared/components/session/GlobalTimerFloatingOverlay'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import {
  TIMER_OVERLAY_LAYOUT_STORAGE_KEY,
  readTimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

function createTimer(
  overrides: Partial<TimedSessionController> & Pick<TimedSessionController, 'sessionId'>,
): TimedSessionController {
  return {
    sessionId: overrides.sessionId,
    sessionKey: overrides.sessionKey ?? overrides.sessionId,
    effectiveSeconds: overrides.effectiveSeconds ?? 65,
    pauseCount: 0,
    status: overrides.status ?? 'running',
    pauseReason: null,
    startedAt: overrides.startedAt ?? null,
    glowState: overrides.glowState ?? 'running',
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSceneActive: vi.fn(),
    leaveScene: vi.fn(async () => null),
    logEvent: vi.fn(),
    getEffectiveSeconds: vi.fn(() => overrides.effectiveSeconds ?? 65),
    complete: vi.fn(async () => null),
    reset: vi.fn(),
    ...overrides,
  }
}

function snapshot(overrides: Partial<UnifiedTimerSnapshot> = {}): UnifiedTimerSnapshot {
  return {
    mode: 'study',
    status: 'running',
    ownerSessionId: 'session-1',
    ownerSessionKey: 'freestyle',
    title: '随心模式',
    scene: '随心模式',
    displaySeconds: 65,
    effectiveSeconds: 65,
    primaryText: '正在计时',
    secondaryText: '有效学习时间 01:05',
    availableActions: ['pause'],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
    semanticState: 'running',
    progressMode: 'elapsed',
    ...overrides,
  }
}

function entry(timer: TimedSessionController): GlobalTimerRegistration {
  return {
    sessionId: timer.sessionId,
    scene: 'freestyle',
    title: '随心模式',
    timer,
    isRouteActive: true,
    becameActiveAt: 1,
    routePath: '/freestyle',
  }
}

describe('GlobalTimerFloatingOverlay', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('hides to a restore control and restores the full panel without pausing', () => {
    const onCommand = vi.fn()
    const timer = createTimer({ sessionId: 'hide-restore' })
    const timerSnapshot = snapshot()

    render(
      <GlobalTimerFloatingOverlay
        entries={[entry(timer)]}
        snapshot={timerSnapshot}
        onCommand={onCommand}
      />,
    )

    expect(screen.getByText('01:05')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '隐藏计时器' }))

    expect(onCommand).toHaveBeenCalledWith({ type: 'closeOverlay' })
    expect(onCommand).not.toHaveBeenCalledWith({ type: 'pause' })
    expect(timer.pause).not.toHaveBeenCalled()
    expect(screen.queryByText('01:05')).toBeNull()
    expect(screen.getByRole('button', { name: '显示悬浮计时器' })).toBeTruthy()
    expect(readTimerOverlayLayout().hidden).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '显示悬浮计时器' }))

    expect(screen.getByText('01:05')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '显示悬浮计时器' })).toBeNull()
    expect(readTimerOverlayLayout()).toMatchObject({ hidden: false, collapsed: false })
  })

  it('can hide from the collapsed capsule', () => {
    const onCommand = vi.fn()
    window.localStorage.setItem(
      TIMER_OVERLAY_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        x: 40,
        y: 80,
        width: 320,
        height: 208,
        collapsed: true,
        hidden: false,
      }),
    )

    render(
      <GlobalTimerFloatingOverlay
        entries={[entry(createTimer({ sessionId: 'capsule-hide' }))]}
        snapshot={snapshot()}
        onCommand={onCommand}
      />,
    )

    expect(screen.getByText(/随心模式 01:05/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '隐藏计时器' }))

    expect(onCommand).toHaveBeenCalledWith({ type: 'closeOverlay' })
    expect(screen.getByRole('button', { name: '显示悬浮计时器' })).toBeTruthy()
    expect(readTimerOverlayLayout().hidden).toBe(true)
  })

  it('keeps shrink as collapse-only', () => {
    const onCommand = vi.fn()
    render(
      <GlobalTimerFloatingOverlay
        entries={[entry(createTimer({ sessionId: 'shrink-only' }))]}
        snapshot={snapshot()}
        onCommand={onCommand}
      />,
    )

    fireEvent.click(screen.getByTitle('折叠为胶囊'))

    expect(onCommand).not.toHaveBeenCalled()
    expect(readTimerOverlayLayout()).toMatchObject({ collapsed: true, hidden: false })
    expect(screen.getByText(/随心模式 01:05/)).toBeTruthy()
  })
})
