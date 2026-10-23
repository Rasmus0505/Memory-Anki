import { describe, expect, it } from 'vitest'
import {
  beijingStudyDay,
  formatLocalDateTimeInputFromDate,
  formatUtcApiDateTime,
  parseApiDateTime,
  parseLocalDateTimeInputValue,
} from '@/shared/lib/dateTime'

describe('dateTime timezone contract', () => {
  it('treats naive API datetimes as UTC', () => {
    const date = parseApiDateTime('2026-07-22T01:00:00')
    expect(date.toISOString()).toBe('2026-07-22T01:00:00.000Z')
  })

  it('parses explicit UTC offsets', () => {
    const date = parseApiDateTime('2026-07-22T01:00:00+00:00')
    expect(date.toISOString()).toBe('2026-07-22T01:00:00.000Z')
  })

  it('formats absolute instants as UTC ISO for API writes', () => {
    const localOneAm = new Date(2026, 6, 22, 1, 0, 0, 0)
    const iso = formatUtcApiDateTime(localOneAm)
    expect(iso.endsWith('Z')).toBe(true)
    // China CST is UTC+8 → 01:00 local is previous day 17:00 UTC
    if (localOneAm.getTimezoneOffset() === -480) {
      expect(iso).toBe('2026-07-21T17:00:00.000Z')
    }
  })

  it('round-trips local datetime-local inputs without +8h skew', () => {
    const input = '2026-07-22T01:00:00'
    const parsed = parseLocalDateTimeInputValue(input)
    expect(formatLocalDateTimeInputFromDate(parsed)).toBe(input)
    if (parsed.getTimezoneOffset() === -480) {
      expect(formatUtcApiDateTime(parsed)).toBe('2026-07-21T17:00:00.000Z')
      // Display path: UTC storage shown back in local time
      const shown = parseApiDateTime(formatUtcApiDateTime(parsed))
      expect(formatLocalDateTimeInputFromDate(shown)).toBe(input)
    }
  })

  it('rolls the study day over at 03:00 Beijing, not at midnight', () => {
    // 16:15Z = 00:15 Beijing on Oct 23 — still the Oct 22 study day.
    expect(beijingStudyDay(new Date('2026-10-22T16:15:00Z'))).toBe('2026-10-22')
    // 18:59Z = 02:59 Beijing on Oct 23 — still Oct 22.
    expect(beijingStudyDay(new Date('2026-10-22T18:59:00Z'))).toBe('2026-10-22')
    // 19:00Z = 03:00 Beijing on Oct 23 — the Oct 23 study day starts.
    expect(beijingStudyDay(new Date('2026-10-22T19:00:00Z'))).toBe('2026-10-23')
  })
})
