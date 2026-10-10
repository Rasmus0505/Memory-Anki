import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLiveForegroundClockSuppressed } from '@/modules/session/public'
import {
  resetStudyClockPresenceForTests,
  setStudyClockDesktopFocusedForTests,
} from '@/modules/practice/ui/studyClockPresence'
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
    setLiveForegroundClockSuppressed(false)
    resetStudyClockPresenceForTests()
    vi.useFakeTimers()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    window.localStorage.clear()
    setVisibility('visible')
  })

  afterEach(() => {
    setLiveForegroundClockSuppressed(false)
    resetStudyClockPresenceForTests()
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

  it('counts a visible page even when the document focus flag is false', () => {
    const { result } = renderHook(() => useForegroundEncounterClock({
      encounterId: 'encounter-visible-unfocused',
      active: true,
      open: true,
    }))

    act(() => {
      vi.mocked(document.hasFocus).mockReturnValue(false)
      window.dispatchEvent(new Event('blur'))
      for (let step = 0; step < 3; step += 1) {
        now += 1000
        vi.advanceTimersByTime(1000)
      }
    })

    expect(result.current.getEffectiveSeconds()).toBe(3)
  })

  it('counts a short leave, then stops without backfilling a long one', () => {
    const { result } = renderHook(() => useForegroundEncounterClock({
      encounterId: 'encounter-grace',
      active: true,
      open: true,
    }))

    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(1)

    act(() => setStudyClockDesktopFocusedForTests(false))
    act(() => {
      for (let step = 0; step < 120; step += 1) {
        now += 1000
        vi.advanceTimersByTime(1000)
      }
    })
    expect(result.current.getEffectiveSeconds()).toBe(121)

    act(() => {
      for (let step = 0; step < 8 * 60; step += 1) {
        now += 1000
        vi.advanceTimersByTime(1000)
      }
    })
    expect(result.current.getEffectiveSeconds()).toBe(1 + 3 * 60)

    act(() => setStudyClockDesktopFocusedForTests(null))
    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(1 + 3 * 60 + 1)
  })

  it('does not count when canAccumulate is false', () => {
    const { result } = renderHook(() => useForegroundEncounterClock({
      encounterId: 'encounter-suppressed',
      active: true,
      open: true,
      canAccumulate: false,
    }))

    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(0)

    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.getEffectiveSeconds()).toBe(0)
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
