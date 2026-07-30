import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForegroundEncounterClock } from './useForegroundEncounterClock'

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useForegroundEncounterClock', () => {
  let now = 0

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    window.localStorage.clear()
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('counts only observed foreground ticks and ignores a browser-freeze gap', () => {
    const { result } = renderHook(() => useForegroundEncounterClock({
      encounterId: 'encounter-visible',
      active: true,
      open: true,
    }))

    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(1)

    act(() => {
      now += 60 * 60 * 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(1)

    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(2)
  })

  it('stops while hidden and resumes without backfilling hidden time', () => {
    const { result } = renderHook(() => useForegroundEncounterClock({
      encounterId: 'encounter-hidden',
      active: true,
      open: true,
    }))

    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    act(() => setVisibility('hidden'))
    act(() => {
      now += 10 * 60 * 1000
      vi.advanceTimersByTime(10 * 60 * 1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(1)

    act(() => setVisibility('visible'))
    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(2)
  })

  it('restores by encounter identity and clears only that encounter', () => {
    window.localStorage.setItem('memory_anki_review_foreground_seconds:encounter-a', '4.4')
    const { result, rerender } = renderHook(
      ({ encounterId }) => useForegroundEncounterClock({ encounterId, active: false, open: true }),
      { initialProps: { encounterId: 'encounter-a' } },
    )

    expect(result.current.getEffectiveSeconds()).toBe(4)
    rerender({ encounterId: 'encounter-b' })
    expect(result.current.getEffectiveSeconds()).toBe(0)
    rerender({ encounterId: 'encounter-a' })
    expect(result.current.getEffectiveSeconds()).toBe(4)

    act(() => result.current.clear())
    expect(window.localStorage.getItem('memory_anki_review_foreground_seconds:encounter-a')).toBeNull()
  })
})
