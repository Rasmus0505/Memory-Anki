import { describe, expect, it } from 'vitest'
import {
  advanceTickState,
  normalizeSnapshot,
  resolveTimedSessionAutomation,
} from './timedSessionModel'

describe('advanceTickState', () => {
  it('advances effective and idle seconds by whole elapsed seconds', () => {
    expect(advanceTickState({
      previousEffectiveSeconds: 10,
      previousIdleSeconds: 0,
      lastTickAtMs: 1_000,
      lastActivityAtMs: 500,
      currentMs: 3_400,
    })).toEqual({
      effectiveSeconds: 12,
      idleSeconds: 2,
      lastTickAtMs: 3_000,
      effectiveChanged: true,
      idleChanged: true,
    })
  })

  it('keeps sub-second effective time stable', () => {
    expect(advanceTickState({
      previousEffectiveSeconds: 10,
      previousIdleSeconds: 0,
      lastTickAtMs: 1_000,
      lastActivityAtMs: 900,
      currentMs: 1_250,
    })).toEqual({
      effectiveSeconds: 10,
      idleSeconds: 0,
      lastTickAtMs: 1_000,
      effectiveChanged: false,
      idleChanged: false,
    })
  })
})

describe('resolveTimedSessionAutomation', () => {
  it('adds the warning grace window to configured inactivity timing', () => {
    expect(resolveTimedSessionAutomation({
      inactiveAutoPauseSeconds: 120,
      inactivePauseGraceSeconds: 30,
      hiddenAutoPauseSeconds: 15,
      autoPauseRollbackSeconds: 0,
    }, {})).toEqual({
      inactivityWarningMs: 120_000,
      inactivityGraceMs: 30_000,
      autoPauseMs: 150_000,
      hiddenPauseMs: 15_000,
      resumeWindowMs: 120_000,
      autoPauseRollbackSeconds: 0,
    })
  })

  it('keeps explicit millisecond auto-pause overrides as the final deadline', () => {
    const resolved = resolveTimedSessionAutomation({
      inactiveAutoPauseSeconds: 120,
      inactivePauseGraceSeconds: 30,
      hiddenAutoPauseSeconds: 15,
      autoPauseRollbackSeconds: 0,
    }, { autoPauseMs: 20_000 })

    expect(resolved.autoPauseMs).toBe(20_000)
    expect(resolved.inactivityWarningMs).toBe(0)
  })
})

describe('normalizeSnapshot focus migration', () => {
  it('starts a fresh focus round at legacy effective time without replaying milestones', () => {
    const snapshot = normalizeSnapshot({
      version: 2,
      recordId: 'legacy',
      kind: 'practice',
      palaceId: 1,
      sourceKind: null,
      englishCourseId: null,
      title: '旧会话',
      effectiveSeconds: 1_800,
      pauseCount: 0,
      status: 'running',
      startedAt: '2026-01-01 10:00:00',
      durationEdited: false,
      events: [],
      persistedAt: '2026-01-01 10:30:00',
      suspended: false,
      suspendedAt: null,
      resumeDeadlineAt: null,
      leaveMeta: null,
    })

    expect(snapshot?.focusRound).toMatchObject({
      roundIndex: 1,
      startedAtEffectiveSeconds: 1_800,
      acknowledgedIntervalCount: 0,
      goalCelebrated: false,
    })
    expect(snapshot?.autoPauseDeadlineAtMs).toBeNull()
  })
})
