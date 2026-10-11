import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFreestyleRoundLearningClock } from './useFreestyleRoundLearningClock'

const api = vi.hoisted(() => ({ backfill: vi.fn(), accumulate: vi.fn() }))
vi.mock('@/modules/practice/ui/freestyle/api/freestyleApi', () => ({
  backfillFreestyleLearningTimeApi: api.backfill,
  accumulateFreestyleLearningTimeApi: api.accumulate,
}))
vi.mock('@/modules/session/public', () => ({
  useLiveStudyPresence: () => null,
  isPassiveLiveStudyFollower: () => false,
  subscribeDwellFragmentOverrides: () => () => undefined,
  peekDwellFragmentOverride: () => null,
}))
vi.mock('@/modules/practice/ui/studyClockPresence', () => ({
  STUDY_AWAY_GRACE_MS: 180000,
  isStudyClockCounting: () => true,
  readStudyClockCounting: () => true,
  subscribeStudyClockPresence: () => () => undefined,
}))

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  api.backfill.mockReset()
  api.accumulate.mockReset()
  let unitSeconds = 0
  const response = () => ({ plan_version: 1, learning_backfill_applied: true, plan: { learning_time: { unit_seconds: unitSeconds, quiz_seconds: 0, lookup_seconds: 0, backfilled: true } } })
  api.backfill.mockImplementation(async () => response())
  api.accumulate.mockImplementation(async (_round, batch) => {
    for (const interval of batch.intervals) unitSeconds += (Date.parse(interval.ended_at) - Date.parse(interval.started_at)) / 1000
    return response()
  })
})
afterEach(() => { vi.useRealTimers() })

describe('settlement learning clock', () => {
  it('includes unsent intervals and refreshes the authoritative day at midnight', async () => {
    const midnight = Date.parse('2025-01-02T16:00:00Z')
    vi.setSystemTime(midnight - 5000)
    api.accumulate.mockRejectedValue(new Error('offline'))
    api.backfill.mockImplementation(async () => {
      const next = Date.now() >= midnight
      return { plan_version: 1, plan: { learning_time: { unit_seconds: 0, quiz_seconds: 0, lookup_seconds: 0, backfilled: true, intervals: [], today: { day: next ? '2025-01-03' : '2025-01-02', started_at: new Date(next ? midnight : midnight - 86400000).toISOString(), ended_at: new Date(next ? midnight + 86400000 : midnight).toISOString(), known_seconds: 0, unattributed_seconds: 0 } } } }
    })
    const { result, unmount } = renderHook(() => useFreestyleRoundLearningClock({ roundId: 'midnight', planVersion: 1, adoptRoundVersion: vi.fn(), isActive: true, viewingCard: true, cardPalaceId: 1, publishLive: true }))
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(result.current.learningTime.today?.known_seconds).toBe(3)
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(result.current.learningTime.today?.day).toBe('2025-01-03')
    expect(result.current.learningTime.today?.known_seconds).toBeGreaterThan(0)
    expect(api.backfill).toHaveBeenCalledTimes(2)
    unmount()
  })

  it.each(['finish overlay', 'closing slot', 'partial settlement'])('pauses %s and resumes the same round without charging idle time', async () => {
    const adoptRoundVersion = vi.fn()
    const { result, rerender, unmount } = renderHook(({ settled }) => useFreestyleRoundLearningClock({
      roundId: 'round-preserved', planVersion: 1, adoptRoundVersion,
      isActive: true, viewingCard: !settled, cardPalaceId: 7, publishLive: settled,
    }), { initialProps: { settled: false } })
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(5000) })
    rerender({ settled: true })
    await act(async () => {})
    const atFinish = result.current.learningTime.unitSeconds
    expect(atFinish).toBe(5)
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect(result.current.learningTime.unitSeconds).toBe(atFinish)
    rerender({ settled: false })
    await act(async () => { vi.advanceTimersByTime(3000) })
    rerender({ settled: true })
    await act(async () => {})
    expect(result.current.learningTime.unitSeconds).toBe(8)
    expect(api.backfill).toHaveBeenCalledTimes(1)
    expect(api.accumulate.mock.calls.every(([round]) => round === 'round-preserved')).toBe(true)
    unmount()
  })
})
