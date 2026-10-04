import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearSharedRequestsForTest,
  invalidateSharedRequest,
  invalidateSharedRequestsByPrefix,
  shareInFlightRequest,
} from './inFlightRequest'

afterEach(() => {
  clearSharedRequestsForTest()
  vi.restoreAllMocks()
})

describe('shareInFlightRequest', () => {
  it('collapses concurrent duplicate requests into one loader call', async () => {
    const loader = vi.fn(async () => ({ items: [1, 2, 3] }))

    const [first, second, third] = await Promise.all([
      shareInFlightRequest('palace:1:bindings', loader),
      shareInFlightRequest('palace:1:bindings', loader),
      shareInFlightRequest('palace:1:bindings', loader),
    ])

    expect(loader).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ items: [1, 2, 3] })
    // Same resolve path for every joiner, not a copy per caller.
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('does not share across different keys', async () => {
    const loader = vi.fn(async (id: number) => ({ palace: id }))

    await Promise.all([
      shareInFlightRequest('palace:1:bindings', () => loader(1)),
      shareInFlightRequest('palace:2:bindings', () => loader(2)),
    ])

    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('issues a fresh request once the previous one settled', async () => {
    const loader = vi.fn(async () => ({ token: Math.random() }))

    await shareInFlightRequest('palace:1:bindings', loader)
    await shareInFlightRequest('palace:1:bindings', loader)

    // Sequential reads must not be served from the shared slot, otherwise the
    // first result would be cached forever and never reflect a write.
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not replay a rejection to later callers', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(shareInFlightRequest('palace:1:bindings', failing)).rejects.toThrow('boom')

    const ok = vi.fn(async () => ({ items: [] as number[] }))
    await expect(shareInFlightRequest('palace:1:bindings', ok)).resolves.toEqual({ items: [] })
    expect(failing).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('invalidateSharedRequest drops an in-flight entry so a mutation is not masked', async () => {
    let resolveFirst: ((value: { items: number[] }) => void) | undefined
    const firstLoader = vi.fn(
      () =>
        new Promise<{ items: number[] }>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const inFlight = shareInFlightRequest('palace:1:bindings', firstLoader)
    invalidateSharedRequest('palace:1:bindings')

    const secondLoader = vi.fn(async () => ({ items: [9] }))
    await expect(shareInFlightRequest('palace:1:bindings', secondLoader)).resolves.toEqual({
      items: [9],
    })
    expect(secondLoader).toHaveBeenCalledTimes(1)

    resolveFirst?.({ items: [1] })
    await expect(inFlight).resolves.toEqual({ items: [1] })
  })

  it('invalidateSharedRequestsByPrefix only drops matching keys', async () => {
    const bindings = vi.fn(async () => ({ kind: 'bindings' }))
    const other = vi.fn(async () => ({ kind: 'other' }))

    const first = shareInFlightRequest('palace:1:bindings', bindings)
    const kept = shareInFlightRequest('palace:1:ladder', other)

    invalidateSharedRequestsByPrefix('palace:1:bindings')

    const fresh = await shareInFlightRequest('palace:1:bindings', bindings)
    await expect(first).resolves.toEqual({ kind: 'bindings' })
    await expect(kept).resolves.toEqual({ kind: 'other' })
    expect(fresh).toEqual({ kind: 'bindings' })
    expect(bindings).toHaveBeenCalledTimes(2)
    expect(other).toHaveBeenCalledTimes(1)
  })
})
