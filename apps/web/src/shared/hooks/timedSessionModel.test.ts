import { describe, expect, it } from 'vitest'
import { advanceTickState } from './timedSessionModel'

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
