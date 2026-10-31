import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useQuizDwellMs } from './useQuizDwellMs'

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

function restoreVisibility() {
  Reflect.deleteProperty(document, 'visibilityState')
}

describe('useQuizDwellMs', () => {
  afterEach(() => {
    restoreVisibility()
    vi.useRealTimers()
  })

  it('pauses while the tab is hidden instead of counting it as retrieval time', () => {
    vi.useFakeTimers()
    setVisibility('visible')
    const { result } = renderHook(() => useQuizDwellMs())

    act(() => result.current.markShown(7))
    act(() => vi.advanceTimersByTime(1000))

    setVisibility('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => vi.advanceTimersByTime(5000))

    setVisibility('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => vi.advanceTimersByTime(1000))

    expect(result.current.elapsedMs(7)).toBe(2000)
  })

  it('restarts the clock when the learner comes back to the question', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useQuizDwellMs())

    act(() => result.current.restart(5))
    act(() => vi.advanceTimersByTime(4000))
    expect(result.current.elapsedMs(5)).toBe(4000)

    act(() => result.current.restart(5))
    expect(result.current.elapsedMs(5)).toBe(0)
  })

  it('returns null until a question is marked shown and after reset', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useQuizDwellMs())

    expect(result.current.elapsedMs(3)).toBeNull()
    act(() => result.current.markShown(3))
    expect(result.current.elapsedMs(3)).not.toBeNull()

    act(() => result.current.reset(3))
    expect(result.current.elapsedMs(3)).toBeNull()
  })
})
