import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPrefetchedPromisesByPrefix,
  clearPromiseWarmupCacheForTest,
  consumePrefetchedPromise,
  peekPrefetchedPromise,
  prefetchPromise,
} from '@/shared/api/promiseWarmupCache'

describe('promiseWarmupCache', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearPromiseWarmupCacheForTest()
  })

  it('consumes a warmed promise once', async () => {
    const loader = vi.fn(() => Promise.resolve('warmed'))
    const fallback = vi.fn(() => Promise.resolve('fallback'))

    prefetchPromise('dashboard:/dashboard', loader)

    await expect(consumePrefetchedPromise('dashboard:/dashboard', fallback)).resolves.toBe('warmed')
    await expect(consumePrefetchedPromise('dashboard:/dashboard', fallback)).resolves.toBe('fallback')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('expires stale warmed promises', async () => {
    vi.useFakeTimers()
    const loader = vi.fn(() => Promise.resolve('old'))
    const fallback = vi.fn(() => Promise.resolve('fresh'))

    prefetchPromise('review:queue', loader, { ttlMs: 10 })
    vi.advanceTimersByTime(11)

    await expect(consumePrefetchedPromise('review:queue', fallback)).resolves.toBe('fresh')
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('prunes oldest entries and clears by prefix', async () => {
    prefetchPromise('palace:a', () => Promise.resolve('a'), { maxEntries: 2 })
    prefetchPromise('palace:b', () => Promise.resolve('b'), { maxEntries: 2 })
    prefetchPromise('dashboard:c', () => Promise.resolve('c'), { maxEntries: 2 })

    expect(peekPrefetchedPromise('palace:a')).toBeUndefined()
    expect(peekPrefetchedPromise('palace:b')).toBeDefined()
    expect(peekPrefetchedPromise('dashboard:c')).toBeDefined()

    clearPrefetchedPromisesByPrefix('palace:')

    expect(peekPrefetchedPromise('palace:b')).toBeUndefined()
    await expect(consumePrefetchedPromise('dashboard:c', () => Promise.resolve('fallback'))).resolves.toBe('c')
  })
})
