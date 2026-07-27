import { describe, expect, it } from 'vitest'
import {
  cleanupLegacyPracticeProgressStorage,
  formatClientSource,
} from '@/modules/session/domain/session-entity/model'

// Trend/breakdown aggregation moved to GET /study-sessions/time-record-analytics;
// the local implementations and their tests were removed with it.
describe('session-record formatters', () => {
  it('formats time record client source labels', () => {
    expect(formatClientSource('desktop')).toBe('电脑端')
    expect(formatClientSource('pwa')).toBe('PWA 端')
    expect(formatClientSource(null)).toBe('未知端')
  })
})

describe('cleanupLegacyPracticeProgressStorage', () => {
  it('removes the retired practice progress localStorage key', () => {
    const legacyKey = ['memory-anki', ['practice', 'progress'].join('-'), 'v1'].join('.')

    window.localStorage.setItem(legacyKey, '{"1":{"completed":false}}')

    cleanupLegacyPracticeProgressStorage()

    expect(window.localStorage.getItem(legacyKey)).toBeNull()
  })
})
