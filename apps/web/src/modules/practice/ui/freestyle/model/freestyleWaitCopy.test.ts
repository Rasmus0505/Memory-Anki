import { describe, expect, it } from 'vitest'
import { remainingLabel, retryWaitLabel } from './freestyleWaitCopy'

const NOW = new Date('2026-10-25T12:00:00Z').getTime()

describe('remainingLabel', () => {
  it('speaks in whole minutes and hours', () => {
    expect(remainingLabel(10 * 60_000)).toBe('10 分钟后')
    expect(remainingLabel(60 * 60_000)).toBe('1 小时后')
    expect(remainingLabel(80 * 60_000)).toBe('1 小时 20 分钟后')
  })

  it('never counts past zero', () => {
    expect(remainingLabel(0)).toBe('马上到点')
    expect(remainingLabel(-5_000)).toBe('马上到点')
  })
})

describe('retryWaitLabel', () => {
  it('reads an offset-aware instant', () => {
    expect(retryWaitLabel('2026-10-25T12:10:00+00:00', NOW)).toBe('10 分钟后重练')
  })

  it('reads a naive API instant as UTC, not local wall time', () => {
    // The backend stores naive UTC. Parsing this as local time shifted the
    // countdown by the UTC offset (eight hours in China).
    expect(retryWaitLabel('2026-10-25T12:10:00', NOW)).toBe('10 分钟后重练')
  })

  it('says it is due once the instant has passed', () => {
    expect(retryWaitLabel('2026-10-25T11:59:00+00:00', NOW)).toBe('重练已到点')
  })

  it('never invents a wait it does not know', () => {
    expect(retryWaitLabel(null, NOW)).toBe('稍后重练')
    expect(retryWaitLabel(undefined, NOW)).toBe('稍后重练')
    expect(retryWaitLabel('not-a-date', NOW)).toBe('稍后重练')
  })
})
