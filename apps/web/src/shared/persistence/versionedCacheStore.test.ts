import { describe, expect, it } from 'vitest'
import { createVersionedCache } from './versionedCacheStore'

describe('versionedCacheStore', () => {
  it('serves a synchronous hit only for the exact revision', () => {
    const cache = createVersionedCache<{ title: string }>('test-units-a')
    cache.put('unit-1', 3, { title: 'v3' })
    expect(cache.getSync('unit-1', 3)).toEqual({ title: 'v3' })
    expect(cache.getSync('unit-1', '3')).toEqual({ title: 'v3' })
    // Edited on the other device: a newer revision must miss, never serve v3.
    expect(cache.getSync('unit-1', 4)).toBeNull()
  })

  it('replaces an older revision in place', () => {
    const cache = createVersionedCache<string>('test-units-b')
    cache.put('unit-1', 1, 'old')
    cache.put('unit-1', 2, 'new')
    expect(cache.getSync('unit-1', 1)).toBeNull()
    expect(cache.getSync('unit-1', 2)).toBe('new')
  })

  it('keeps namespaces apart', () => {
    const units = createVersionedCache<string>('test-units-c')
    const palaces = createVersionedCache<string>('test-palaces-c')
    units.put('1', 1, 'unit')
    expect(palaces.getSync('1', 1)).toBeNull()
  })

  it('deletes and degrades to a miss without IndexedDB', async () => {
    const cache = createVersionedCache<string>('test-units-d')
    cache.put('unit-1', 1, 'value')
    cache.delete('unit-1')
    expect(cache.getSync('unit-1', 1)).toBeNull()
    await expect(cache.get('unit-1', 1)).resolves.toBeNull()
    await expect(cache.hydrate()).resolves.toBeUndefined()
  })
})
