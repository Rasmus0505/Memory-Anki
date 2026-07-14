import { describe, expect, it } from 'vitest'
import { resolvePageHistoryKey, resolvePageHistorySection } from './pageHistoryRoute'

describe('pageHistoryRoute', () => {
  it('builds stable object keys for dynamic learning pages', () => {
    expect(resolvePageHistoryKey('/palaces/42')).toBe('palace:view:42')
    expect(resolvePageHistoryKey('/palaces/42/practice')).toBe('palace:practice:42')
    expect(resolvePageHistoryKey('/segments/8/practice')).toBe('segment:practice:8')
    expect(resolvePageHistoryKey('/english/courses/7')).toBe('english:course:7')
    expect(resolvePageHistoryKey('/review/session/9')).toBe('review:session:9')
  })

  it('maps nested routes to their navigation section', () => {    expect(resolvePageHistorySection('/profile/backups')).toBe('profile')
    expect(resolvePageHistorySection('/timer-overlay')).toBe('other')
  })
})
