import { describe, expect, it } from 'vitest'
import {
  appendClickInterval,
  countableUntilMs,
  rollbackClickIntervals,
  STUDY_THINKING_GRACE_MS,
  thinkingGraceExceeded,
  transitionClickTimer,
} from './clickTimerPolicy'

describe('transitionClickTimer', () => {
  it('keeps the timer running through the thinking grace', () => {
    expect(transitionClickTimer({
      status: 'running',
      effectiveMs: 12_000,
      lastClickAtMs: 0,
      currentMs: STUDY_THINKING_GRACE_MS,
    })).toEqual({
      status: 'running',
      effectiveMs: 12_000,
      lastClickAtMs: STUDY_THINKING_GRACE_MS,
      timedOut: false,
    })
  })

  it('pauses after the grace without subtracting the thinking window', () => {
    expect(thinkingGraceExceeded(0, STUDY_THINKING_GRACE_MS + 1)).toBe(true)
    expect(countableUntilMs(0, 30 * 60 * 1000)).toBe(STUDY_THINKING_GRACE_MS)
    expect(transitionClickTimer({
      status: 'running',
      effectiveMs: 90_000,
      lastClickAtMs: 0,
      currentMs: 30 * 60 * 1000,
    })).toEqual({
      status: 'paused',
      effectiveMs: 90_000,
      lastClickAtMs: 0,
      timedOut: true,
    })
  })

  it('starts a new interval from idle without changing accrued time', () => {
    expect(transitionClickTimer({
      status: 'paused',
      effectiveMs: 9_000,
      lastClickAtMs: null,
      currentMs: 50,
    })).toEqual({
      status: 'running',
      effectiveMs: 9_000,
      lastClickAtMs: 50,
      timedOut: false,
    })
  })

  it('can still trim an already recorded tail', () => {
    const intervals = appendClickInterval([], 0, 120_000)
    expect(rollbackClickIntervals(intervals, 30_000)).toEqual([{
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(90_000).toISOString(),
    }])
  })
})
