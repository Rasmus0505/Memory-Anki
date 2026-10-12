import { describe, expect, it } from 'vitest'
import {
  dayRecapStorageKey,
  isDayRecapPending,
  localDateKey,
  markDayRecapShown,
} from './freestyleDayRecap'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('freestyleDayRecap', () => {
  it('keys the flag by local calendar date', () => {
    expect(localDateKey(new Date(2026, 9, 12, 0, 30))).toBe('2026-10-12')
    expect(dayRecapStorageKey('2026-10-12')).toBe('freestyle.dayRecap.2026-10-12')
  })

  it('is pending once per local day and resets on the next day', () => {
    const storage = memoryStorage()
    const morning = new Date(2026, 9, 12, 8, 0)
    expect(isDayRecapPending(storage, morning)).toBe(true)
    markDayRecapShown(storage, morning)
    expect(isDayRecapPending(storage, new Date(2026, 9, 12, 23, 59))).toBe(false)
    expect(isDayRecapPending(storage, new Date(2026, 9, 13, 0, 1))).toBe(true)
  })
})
