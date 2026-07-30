import { describe, expect, it } from 'vitest'
import type { DailyTrendPoint } from '@/modules/session/domain/session-entity/model/session-records'
import { bucketTrendPoints } from './TimeRecordsTrendChart.view'

function makeTrend(days: number, secondsPerDay = 60): DailyTrendPoint[] {
  return Array.from({ length: days }, (_, index) => ({
    dateKey: `2026-01-${String(index + 1).padStart(2, '0')}`,
    label: `1/${index + 1}`,
    seconds: secondsPerDay,
  }))
}

describe('bucketTrendPoints', () => {
  it('leaves ranges at or under the cap untouched', () => {
    const trend = makeTrend(120)
    expect(bucketTrendPoints(trend)).toBe(trend)
  })

  it('preserves total study time when bucketing a long history', () => {
    const trend = makeTrend(365)
    const bucketed = bucketTrendPoints(trend)

    expect(bucketed.length).toBeLessThanOrEqual(90)
    expect(bucketed.reduce((total, point) => total + point.seconds, 0)).toBe(365 * 60)
  })

  it('labels multi-day buckets as a range', () => {
    const bucketed = bucketTrendPoints(makeTrend(365))
    expect(bucketed[0].label).toContain('-')
    expect(bucketed[0].dateKey).toBe('2026-01-01')
  })
})
