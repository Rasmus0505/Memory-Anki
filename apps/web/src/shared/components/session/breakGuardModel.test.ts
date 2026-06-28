import {
  createBreakGuardCountdown,
  expireBreakGuardIfDue,
  formatBreakGuardClock,
  snoozeBreakGuard,
} from './breakGuardModel'

describe('break guard model', () => {
  it('creates countdown state from minutes', () => {
    expect(createBreakGuardCountdown(10, 1_000, 'log-1')).toMatchObject({
      status: 'counting_down',
      startedAt: 1_000,
      plannedMinutes: 10,
      expiresAt: 601_000,
      logId: 'log-1',
    })
  })

  it('expires only after deadline', () => {
    const state = createBreakGuardCountdown(1, 0)
    expect(expireBreakGuardIfDue(state, 59_999).status).toBe('counting_down')
    expect(expireBreakGuardIfDue(state, 60_000).status).toBe('expired')
  })

  it('snoozes an expired break and increments count', () => {
    const state = { ...createBreakGuardCountdown(1, 0), status: 'expired' as const }
    expect(snoozeBreakGuard(state, 3, 60_000)).toMatchObject({
      status: 'counting_down',
      expiresAt: 240_000,
      snoozeCount: 1,
    })
  })

  it('formats remaining time', () => {
    expect(formatBreakGuardClock(61_000)).toBe('01:01')
    expect(formatBreakGuardClock(60_001)).toBe('01:01')
    expect(formatBreakGuardClock(60_000)).toBe('01:00')
  })
})
