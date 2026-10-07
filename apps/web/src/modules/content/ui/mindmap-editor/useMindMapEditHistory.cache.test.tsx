import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MindMapDoc } from '@/shared/api/contracts'
import { useMindMapEditHistory } from './useMindMapEditHistory'

function makeDoc(text: string): MindMapDoc {
  return {
    root: { data: { uid: 'root', text }, children: [] },
  }
}

/**
 * The module keeps a WeakMap keyed by document identity, so every comparison of
 * the same snapshot must be free after the first one. These tests count real
 * `JSON.stringify` calls to prove the cache is on the hot edit path.
 */
describe('mind map edit history fingerprint cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serialises a stable snapshot only once across repeated comparisons', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    const onApply = vi.fn()
    // A single frozen snapshot, the way an immutable store hands one back.
    const stable = makeDoc('A')
    const { result } = renderHook(() => useMindMapEditHistory(stable, onApply))

    stringify.mockClear()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      act(() => {
        expect(result.current.commit(stable)).toBe(false)
      })
    }

    // Identity-keyed cache: the same snapshot must never be stringified twice.
    const callsForStable = stringify.mock.calls.filter((call) => call[0] === stable).length
    expect(callsForStable).toBeLessThanOrEqual(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('does not re-serialise a snapshot that was already fingerprinted', () => {
    const stringify = vi.spyOn(JSON, 'stringify')
    const onApply = vi.fn()
    const base = makeDoc('A')
    const { result } = renderHook(() => useMindMapEditHistory(base, onApply))

    stringify.mockClear()

    // `commitFrom` compares base against next, then `publish` fingerprints next.
    // With the cache the base doc is serialised at most once per comparison.
    act(() => {
      result.current.commitFrom(base, makeDoc('B'))
    })

    const callsForBase = stringify.mock.calls.filter((call) => call[0] === base).length
    expect(callsForBase).toBeLessThanOrEqual(1)
  })

  it('still records a real change and exposes it as undoable', () => {
    const onApply = vi.fn()
    const { result } = renderHook(() => useMindMapEditHistory(makeDoc('A'), onApply))

    let committed = false
    act(() => {
      committed = result.current.commit(makeDoc('B'))
    })

    expect(committed).toBe(true)
    expect(result.current.canUndo).toBe(true)
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('B'))

    act(() => {
      result.current.undo()
    })
    expect(onApply).toHaveBeenLastCalledWith(makeDoc('A'))
  })
})
