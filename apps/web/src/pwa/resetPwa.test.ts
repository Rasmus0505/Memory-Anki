import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetPwaRuntime } from './resetPwa'

describe('resetPwaRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('unregisters root service workers and deletes only Memory Anki PWA caches', async () => {
    const unregisterRoot = vi.fn().mockResolvedValue(true)
    const unregisterNested = vi.fn().mockResolvedValue(true)
    const deleteCache = vi.fn().mockResolvedValue(true)

    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn().mockResolvedValue([
          { scope: 'https://example.test/', unregister: unregisterRoot },
          { scope: 'https://example.test/other/', unregister: unregisterNested },
        ]),
      },
    })
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue([
        'memory-anki-pwa-app-2026-07-07',
        'memory-anki-mobile-app-old',
        'third-party-cache',
      ]),
      delete: deleteCache,
    })

    const result = await resetPwaRuntime()

    expect(unregisterRoot).toHaveBeenCalledTimes(1)
    expect(unregisterNested).not.toHaveBeenCalled()
    expect(deleteCache).toHaveBeenCalledTimes(2)
    expect(deleteCache).toHaveBeenCalledWith('memory-anki-pwa-app-2026-07-07')
    expect(deleteCache).toHaveBeenCalledWith('memory-anki-mobile-app-old')
    expect(deleteCache).not.toHaveBeenCalledWith('third-party-cache')
    expect(result).toEqual({
      unregisteredServiceWorkers: 1,
      deletedCaches: 2,
    })
  })
})
