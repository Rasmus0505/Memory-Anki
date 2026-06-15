import { describe, expect, it } from 'vitest'
import { computeLruEvictions, MAX_CACHED_ENTRIES } from '@/app/router/AppRouter'

describe('computeLruEvictions', () => {
  it('returns nothing when under the limit', () => {
    expect(computeLruEvictions(['/a', '/b'], '/a', { '/a': 1, '/b': 2 }, 12)).toEqual([])
  })

  it('returns nothing when exactly at the limit', () => {
    const keys = Array.from({ length: MAX_CACHED_ENTRIES }, (_, i) => `/p${i}`)
    const times: Record<string, number> = {}
    keys.forEach((k, i) => (times[k] = i))
    expect(computeLruEvictions(keys, '/p0', times, MAX_CACHED_ENTRIES)).toEqual([])
  })

  it('evicts the least-recently-activated non-active entries', () => {
    const keys = ['/a', '/b', '/c', '/d', '/e']
    const times = { '/a': 100, '/b': 50, '/c': 300, '/d': 10, '/e': 200 }
    // 上限 3，共 5 条，应驱逐 2 条；活动条目 /c 不驱逐。
    // 剩余候选按时间升序：/d(10) /b(50) /a(100) /e(200) → 取前 2 → /d /b
    const evictions = computeLruEvictions(keys, '/c', times, 3)
    expect(evictions).toEqual(['/d', '/b'])
  })

  it('never evicts the active key even if it is the oldest', () => {
    const keys = ['/a', '/b', '/c']
    const times = { '/a': 1, '/b': 2, '/c': 3 }
    // /a 最旧但是活动条目；上限 2 → 驱逐 1 条 → 应是次旧的 /b
    const evictions = computeLruEvictions(keys, '/a', times, 2)
    expect(evictions).toEqual(['/b'])
  })

  it('handles missing activation timestamps as oldest (0)', () => {
    const keys = ['/a', '/b', '/c', '/d']
    const times = { '/a': 100 } // /b /c /d 缺失，视为 0
    // 上限 2，共 4，驱逐 2；活动 /a 不驱逐。候选 /b /c /d(均0) 排序稳定后取前2。
    const evictions = computeLruEvictions(keys, '/a', times, 2)
    expect(evictions).toHaveLength(2)
    expect(evictions.every((k) => k !== '/a')).toBe(true)
  })
})
