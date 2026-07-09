import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkLoadError, isChunkLoadError, loadLazyModuleWithRetry } from './lazyWithRetry'

describe('lazyWithRetry helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('detects common dynamic import chunk load failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true)
    expect(isChunkLoadError(new Error('ordinary render failure'))).toBe(false)
  })

  it('retries the importer once before returning the lazy module', async () => {
    vi.useFakeTimers()
    const Component = () => null
    const importer = vi
      .fn<() => Promise<{ default: typeof Component }>>()
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce({ default: Component })

    const promise = loadLazyModuleWithRetry(importer)
    await vi.advanceTimersByTimeAsync(500)

    await expect(promise).resolves.toEqual({ default: Component })
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('normalizes persistent chunk failures after the retry', async () => {
    vi.useFakeTimers()
    const importer = vi
      .fn<() => Promise<{ default: () => null }>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockRejectedValueOnce(new Error('Loading chunk page failed'))

    const promise = loadLazyModuleWithRetry(importer)
    const assertion = expect(promise).rejects.toBeInstanceOf(ChunkLoadError)
    await vi.advanceTimersByTimeAsync(500)

    await assertion
    expect(importer).toHaveBeenCalledTimes(2)
  })
})
