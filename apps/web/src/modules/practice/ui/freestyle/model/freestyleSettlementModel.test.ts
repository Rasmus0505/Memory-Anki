import { describe, expect, it } from 'vitest'
import {
  judgeFreestyleSaveOutcome,
  progressPercent,
  remainingDelta,
} from './freestyleSettlementModel'

const ok = (overrides: Partial<{ version: number; conflict: boolean; duplicate: boolean; completedCount: number }> = {}) => ({
  version: 5,
  conflict: false,
  duplicate: false,
  completedCount: 3,
  ...overrides,
})

describe('judgeFreestyleSaveOutcome', () => {
  const before = { beforeVersion: 4, beforeCompleted: 2 }

  it('confirms a save only when the version advanced and progress did not move back', () => {
    expect(judgeFreestyleSaveOutcome({ ...before, response: ok() })).toBe('saved')
  })

  it('treats a server duplicate as already saved', () => {
    expect(judgeFreestyleSaveOutcome({ ...before, response: ok({ version: 4, duplicate: true }) })).toBe('saved')
  })

  it('does not claim success when a 2xx leaves the version unchanged', () => {
    expect(judgeFreestyleSaveOutcome({ ...before, response: ok({ version: 4 }) })).toBe('unconfirmed')
  })

  it('does not claim success when completed count goes backwards', () => {
    expect(judgeFreestyleSaveOutcome({ ...before, response: ok({ completedCount: 1 }) })).toBe('unconfirmed')
  })

  it('reports conflict for 409 and for a conflict flag', () => {
    expect(judgeFreestyleSaveOutcome({ ...before, response: null, httpStatus: 409 })).toBe('conflict')
    expect(judgeFreestyleSaveOutcome({ ...before, response: ok({ conflict: true }) })).toBe('conflict')
  })

  it('reports failed for network errors, 5xx and missing responses', () => {
    expect(judgeFreestyleSaveOutcome({ ...before, response: null, networkError: true })).toBe('failed')
    expect(judgeFreestyleSaveOutcome({ ...before, response: null, httpStatus: 503 })).toBe('failed')
    expect(judgeFreestyleSaveOutcome({ ...before, response: null })).toBe('failed')
  })
})

describe('progressPercent', () => {
  it('rounds and clamps to 0..100', () => {
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(3, 3)).toBe(100)
    expect(progressPercent(5, 3)).toBe(100)
    expect(progressPercent(-1, 3)).toBe(0)
  })

  it('returns 0 for an empty or invalid total', () => {
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(1, Number.NaN)).toBe(0)
  })
})

describe('remainingDelta', () => {
  it('reports what was cleared between two snapshots', () => {
    expect(remainingDelta(12, 7)).toEqual({ before: 12, after: 7, cleared: 5 })
  })

  it('never reports negative clearing', () => {
    expect(remainingDelta(7, 12).cleared).toBe(0)
  })
})
