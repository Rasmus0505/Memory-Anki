import { describe, expect, it } from 'vitest'
import {
  createDefaultTimeRecordFilter,
  normalizeTimeRecordFilter,
} from './time-record-filter'

describe('time-record-filter', () => {
  it('defaults to the current calendar month', () => {
    expect(createDefaultTimeRecordFilter(new Date(2026, 6, 30))).toMatchObject({
      rangeMode: 'month',
      month: '2026-07',
      keyword: '',
      kind: 'all',
    })
  })

  it('migrates the legacy dashboard month filter', () => {
    expect(
      normalizeTimeRecordFilter(
        {
          mode: 'month',
          month: '2026-05',
          startDate: '',
          endDate: '',
          trendRangeDays: 'all',
          breakdownRangeDays: 90,
        },
        new Date(2026, 6, 30),
      ),
    ).toMatchObject({
      version: 2,
      rangeMode: 'month',
      month: '2026-05',
      rollingDays: 30,
    })
  })

  it('migrates the legacy custom date range', () => {
    expect(
      normalizeTimeRecordFilter({
        mode: 'range',
        month: '2026-06',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      }),
    ).toMatchObject({
      rangeMode: 'custom',
      startDate: '2026-06-01',
      endDate: '2026-06-15',
    })
  })
})
