import { describe, expect, it } from 'vitest'
import { appendClickInterval, CLICK_IDLE_LIMIT_MS, rollbackClickIntervals, transitionClickTimer } from './clickTimerPolicy'

describe('transitionClickTimer', () => {
  it('keeps the timer running at exactly five minutes', () => {
    expect(transitionClickTimer({ status: 'running', effectiveMs: 12_000, lastClickAtMs: 0, currentMs: CLICK_IDLE_LIMIT_MS })).toEqual({ status: 'running', effectiveMs: 12_000, lastClickAtMs: CLICK_IDLE_LIMIT_MS, timedOut: false })
  })
  it('caps the silent interval, rolls back five minutes, and starts a new interval', () => {
    expect(transitionClickTimer({ status: 'running', effectiveMs: 420_000, lastClickAtMs: 0, currentMs: CLICK_IDLE_LIMIT_MS + 1 })).toEqual({ status: 'running', effectiveMs: 120_000, lastClickAtMs: CLICK_IDLE_LIMIT_MS + 1, timedOut: true })
  })
  it('starts a new interval from idle or a prior timeout without changing accrued time', () => {
    expect(transitionClickTimer({ status: 'paused', effectiveMs: 9_000, lastClickAtMs: null, currentMs: 50 })).toEqual({ status: 'running', effectiveMs: 9_000, lastClickAtMs: 50, timedOut: false })
  })
  it('records absolute intervals and rolls back from the tail', () => {
    const intervals = appendClickInterval([], 0, 600_000)
    expect(rollbackClickIntervals(intervals, CLICK_IDLE_LIMIT_MS)).toEqual([{ startedAt: new Date(0).toISOString(), endedAt: new Date(300_000).toISOString() }])
  })
})
