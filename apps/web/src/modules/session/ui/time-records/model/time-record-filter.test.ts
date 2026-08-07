import { describe, expect, it } from 'vitest'
import {
  createDefaultTimeRecordFilter,
  formatTimeRecordRangeLabel,
  normalizeTimeRecordFilter,
} from './time-record-filter'

describe('time-record-filter', () => {
  it('defaults to today while retaining the current month for month mode', () => {
    expect(createDefaultTimeRecordFilter(new Date(2026, 6, 30))).toMatchObject({
      rangeMode: 'today',
      month: '2026-07',
      keyword: '',
      kind: 'all',
    })
  })

  it('keeps an existing persisted month range', () => {
    expect(
      normalizeTimeRecordFilter({
        version: 2,
        rangeMode: 'month',
        month: '2026-06',
        rollingDays: 30,
        startDate: '',
        endDate: '',
        keyword: '',
        kind: 'all',
        sortBy: 'started_at',
        sortOrder: 'desc',
        pageSize: 20,
      }),
    ).toMatchObject({ rangeMode: 'month', month: '2026-06' })
  })

  it('labels today explicitly', () => {
    expect(
      formatTimeRecordRangeLabel({
        ...createDefaultTimeRecordFilter(),
        rangeMode: 'today',
      }),
    ).toBe('今天')
  })
})
