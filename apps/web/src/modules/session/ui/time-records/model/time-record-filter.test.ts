import { describe, expect, it } from 'vitest'
import { createDefaultTimeRecordFilter } from './time-record-filter'

describe('time-record-filter', () => {
  it('defaults to the current calendar month', () => {
    expect(createDefaultTimeRecordFilter(new Date(2026, 6, 30))).toMatchObject({
      rangeMode: 'month',
      month: '2026-07',
      keyword: '',
      kind: 'all',
    })
  })
})
