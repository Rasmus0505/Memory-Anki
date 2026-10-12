import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutosaveDocument } from './useAutosaveDocument'

describe('useAutosaveDocument', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not persist the initial value', async () => {
    const persist = vi.fn()
    const { result } = renderHook(() => useAutosaveDocument({ value: { n: 1 }, persist }))
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(persist).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('debounces edits and persists the latest value once', async () => {
    const persist = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useAutosaveDocument({ value, persist }),
      { initialProps: { value: { n: 1 } } },
    )
    rerender({ value: { n: 2 } })
    rerender({ value: { n: 3 } })
    expect(result.current.status).toBe('pending')
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({ n: 3 })
    expect(result.current.status).toBe('saved')
  })

  it('retries failed saves and reports error after the last retry', async () => {
    const persist = vi.fn(() => {
      throw new Error('offline')
    })
    const { result, rerender } = renderHook(
      ({ value }) => useAutosaveDocument({ value, persist, retryDelaysMs: [100] }),
      { initialProps: { value: { n: 1 } } },
    )
    rerender({ value: { n: 2 } })
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('error')
  })
})
