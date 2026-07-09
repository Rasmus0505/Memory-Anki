import { describe, expect, it } from 'vitest'
import {
  calculateAutoPauseTransition,
  getIdleSecondsAt,
} from './timedSessionAutoPause'

describe('timedSessionAutoPause', () => {
  it('calculates idle seconds from the last activity timestamp', () => {
    expect(getIdleSecondsAt({
      lastActivityAtMs: 1_000,
      currentMs: 4_400,
    })).toBe(3)
  })

  it('uses zero idle seconds when activity has not been tracked', () => {
    expect(getIdleSecondsAt({
      lastActivityAtMs: null,
      currentMs: 4_400,
    })).toBe(0)
  })

  it('rolls back only the idle tail allowed by config', () => {
    expect(calculateAutoPauseTransition({
      effectiveSeconds: 20,
      pauseCount: 1,
      idleSecondsAtPause: 8,
      maxRollbackSeconds: 5,
    })).toEqual({
      rollbackSeconds: 5,
      effectiveSeconds: 15,
      idleSeconds: 0,
      pauseCount: 2,
    })
  })

  it('does not roll effective seconds below zero', () => {
    expect(calculateAutoPauseTransition({
      effectiveSeconds: 3,
      pauseCount: 0,
      idleSecondsAtPause: 8,
      maxRollbackSeconds: 5,
    })).toMatchObject({
      rollbackSeconds: 5,
      effectiveSeconds: 0,
    })
  })
})
