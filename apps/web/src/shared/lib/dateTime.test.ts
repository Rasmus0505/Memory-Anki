import { describe, expect, it } from 'vitest'
import {
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
})
