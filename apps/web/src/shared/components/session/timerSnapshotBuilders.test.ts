import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_BREAK_GUARD_CONFIG } from '@/shared/components/session/break-guard-config'
import { DEFAULT_TIMER_AUTOMATION_CONFIG } from '@/shared/components/session/timer-automation-config'
import { DEFAULT_TIMER_FOCUS_CONFIG } from '@/shared/components/session/timer-focus-config'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import {
  buildBreakTimerSnapshot,
  buildStudyTimerSnapshot,
} from '@/shared/components/session/timerSnapshotBuilders'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

function createEntry(overrides?: Partial<TimedSessionController>): GlobalTimerRegistration {
  const timer = {
    sessionId: 'session-1',
    effectiveSeconds: 0,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'running',
    startedAt: '2026-07-10 10:00:00',
    durationEdited: false,
    glowState: 'running',
    focusRound: {
      roundIndex: 1,
      startedAtEffectiveSeconds: 0,
      acknowledgedIntervalCount: 0,
      goalCelebrated: false,
    },
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    setSceneActive: vi.fn(),
    leaveScene: vi.fn(),
    registerActivity: vi.fn(),
    logEvent: vi.fn(),
    acknowledgeFocusInterval: vi.fn(),
    acknowledgeFocusGoal: vi.fn(),
    startNextFocusRound: vi.fn(),
    adjustDuration: vi.fn(),
    complete: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as TimedSessionController

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

describe('buildStudyTimerSnapshot', () => {
  it('uses effective elapsed time as the main clock and exposes the goal prompt', () => {
    const snapshot = buildStudyTimerSnapshot({
      activeEntry: createEntry({ effectiveSeconds: 1_502 }),
      focusConfig: DEFAULT_TIMER_FOCUS_CONFIG,
      automationConfig: DEFAULT_TIMER_AUTOMATION_CONFIG,
    })

    expect(snapshot.displaySeconds).toBe(1_502)
    expect(snapshot.studyPhase).toBe('goal_reached')
    expect(snapshot.roundElapsedSeconds).toBe(1_502)
    expect(snapshot.roundTargetSeconds).toBe(1_500)
    expect(snapshot.suggestedBreakMinutes).toBe(5)
    expect(snapshot.availableActions).toEqual(['continueRound', 'startGoalBreak'])
  })

  it('shows the 30-second idle warning without changing running timer status', () => {
    const snapshot = buildStudyTimerSnapshot({
      activeEntry: createEntry({ effectiveSeconds: 120, idleSeconds: 90 }),
      focusConfig: DEFAULT_TIMER_FOCUS_CONFIG,
      automationConfig: DEFAULT_TIMER_AUTOMATION_CONFIG,
    })

    expect(snapshot.status).toBe('running')
    expect(snapshot.studyPhase).toBe('idle_warning')
    expect(snapshot.idleWarningRemainingSeconds).toBe(30)
    expect(snapshot.availableActions).toEqual(['pause'])
  })

  it('keeps total elapsed time while resetting only the next round progress', () => {
    const snapshot = buildStudyTimerSnapshot({
      activeEntry: createEntry({
        effectiveSeconds: 1_620,
        focusRound: {
          roundIndex: 2,
          startedAtEffectiveSeconds: 1_500,
          acknowledgedIntervalCount: 0,
          goalCelebrated: false,
        },
      }),
      focusConfig: DEFAULT_TIMER_FOCUS_CONFIG,
      automationConfig: DEFAULT_TIMER_AUTOMATION_CONFIG,
    })

    expect(snapshot.displaySeconds).toBe(1_620)
    expect(snapshot.roundElapsedSeconds).toBe(120)
    expect(snapshot.roundIndex).toBe(2)
  })
})

describe('buildBreakTimerSnapshot', () => {
  it('requires an explicit start-study command after break expiry', () => {
    const snapshot = buildBreakTimerSnapshot({
      breakState: {
        status: 'expired',
        startedAt: 1,
        plannedMinutes: 5,
        expiresAt: 2,
        snoozeCount: 0,
        logId: null,
      },
      config: DEFAULT_BREAK_GUARD_CONFIG,
      paused: false,
    })

    expect(snapshot.availableActions).toEqual(['snooze', 'startStudy'])
    expect(snapshot.primaryText).toContain('手动开始学习')
  })
})
