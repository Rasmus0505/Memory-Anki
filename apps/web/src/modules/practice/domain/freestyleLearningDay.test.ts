import { describe, expect, it } from 'vitest'
import { emptyFreestyleLearningTime, parseFreestyleLearningTime, projectFreestyleLearningDay } from './freestyleLearningTime'
import type { FreestyleLearningInterval } from '@/shared/api/contracts'

const start = Date.parse('2025-01-01T16:00:00Z')
const fact = (id: string, from: number, to: number): FreestyleLearningInterval => ({ interval_id: id, session_id: 's', bucket: 'unit', client_source: 'desktop', started_at: new Date(start + from * 1000).toISOString(), ended_at: new Date(start + to * 1000).toISOString() })
const baseline = { ...emptyFreestyleLearningTime(), intervals: [fact('saved', -30, 30)], today: { day: '2025-01-02', started_at: new Date(start).toISOString(), ended_at: new Date(start + 86400000).toISOString(), known_seconds: 30, unattributed_seconds: 10 } }

describe('round daily time projection', () => {
  it('clips midnight and counts overlapping, inflight or already acknowledged intervals once', () => {
    const result = projectFreestyleLearningDay(baseline, [fact('saved', -30, 30), fact('pending', 0, 60), fact('pending', 0, 60), fact('live', 50, 80)], 5, start + 90000)
    expect(result?.known_seconds).toBe(80)
    expect(result?.unattributed_seconds).toBe(15)
  })
  it('preserves authoritative date window and interval evidence through persistence', () => {
    expect(parseFreestyleLearningTime(JSON.parse(JSON.stringify(baseline)))).toEqual(baseline)
  })
  it('rejects malformed saved day values and intervals instead of rendering NaN', () => {
    const parsed = parseFreestyleLearningTime({ today: { ...baseline.today, started_at: 'broken', known_seconds: 'bad' }, intervals: [{ started_at: 'bad' }] })
    expect(parsed.today).toBeUndefined()
    expect(parsed.intervals).toEqual([])
  })
  it('does not present yesterday as today or guess a missing calendar', () => {
    expect(projectFreestyleLearningDay(baseline, [], 0, start + 86400000)).toBeUndefined()
    expect(projectFreestyleLearningDay(emptyFreestyleLearningTime(), [], 0, start)).toBeUndefined()
  })
})
