import { describe, expect, it, vi } from 'vitest'
import { buildStudyTimerSnapshot } from '@/shared/components/session/timerSnapshotBuilders'
import type { GlobalTimerRegistration } from '@/shared/components/session/globalTimerModel'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'

function createEntry(overrides: Partial<TimedSessionController> = {}): GlobalTimerRegistration {
  const timer = {
    sessionId: 'session-1',
    sessionKey: 'freestyle',
    effectiveSeconds: 42,
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
    getEffectiveSeconds: vi.fn(() => 42),
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
  it('publishes the effective clock and only pause/resume actions', () => {
    const snapshot = buildStudyTimerSnapshot({ activeEntry: createEntry() })
    expect(snapshot.mode).toBe('study')
    expect(snapshot.status).toBe('running')
    expect(snapshot.displaySeconds).toBe(42)
    expect(snapshot.ownerSessionKey).toBe('freestyle')
    expect(snapshot.availableActions).toEqual(['pause'])
    expect(snapshot.progressMode).toBe('elapsed')
  })

  it('freezes a manually paused session without idle or focus metadata', () => {
    const snapshot = buildStudyTimerSnapshot({
      activeEntry: createEntry({ status: 'paused', effectiveSeconds: 90 }),
    })
    expect(snapshot.availableActions).toEqual(['resume'])
    expect(snapshot.semanticState).toBe('paused')
  })

  it('returns a neutral idle snapshot without an owner', () => {
    const snapshot = buildStudyTimerSnapshot({ activeEntry: null })
    expect(snapshot.status).toBe('idle')
    expect(snapshot.ownerSessionId).toBeNull()
    expect(snapshot.availableActions).toEqual([])
  })
})
