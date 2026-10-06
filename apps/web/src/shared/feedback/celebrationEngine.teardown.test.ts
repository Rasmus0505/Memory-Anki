import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCelebrationEngineForTests,
  launchCelebrationPreset,
} from './celebrationEngine'

/**
 * Regression guard: a celebration must not touch `window` after teardown.
 *
 * `launchCelebrationPreset` schedules an interval and a cleanup timeout up to
 * `durationMs` ahead. In the full suite those callbacks could fire after jsdom had
 * torn the environment down, so `window.clearInterval(...)` inside the callback
 * threw `ReferenceError: window is not defined` as an unhandled exception once the
 * suite had already reported green — which fails `quality_gate --full` even though
 * every test passes.
 *
 * The engine now reads its timer functions off `globalThis` when the work is
 * scheduled, so this deletes `window` before the timers fire to reproduce exactly
 * that condition.
 */

describe('celebrationEngine teardown safety', () => {
  afterEach(() => {
    __resetCelebrationEngineForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('survives its scheduled callbacks firing after the window is gone', () => {
    vi.useFakeTimers()
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(event.error ?? event.message)
    }
    // jsdom surfaces the late ReferenceError as an uncaught error event.
    // Hold the object itself: the test stubs the global away below, so reading
    // `window` again in the cleanup would fail for the test's own reasons.
    const realWindow = window
    realWindow.addEventListener('error', onError)

    try {
      launchCelebrationPreset({
        preset: 'random_direction',
        reducedMotion: false,
        amount: 1,
        durationMs: 120,
      })

      // Everything is scheduled. Remove the global the callbacks used to depend on,
      // then let both the interval ticks and the cleanup timeout run.
      vi.stubGlobal('window', undefined)
      expect(() => vi.advanceTimersByTime(400)).not.toThrow()

      expect(errors).toEqual([])
    } finally {
      realWindow.removeEventListener('error', onError)
    }
  })

  it('still schedules and stops its interval while the window is present', () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    launchCelebrationPreset({
      preset: 'random_direction',
      reducedMotion: false,
      amount: 1,
      durationMs: 120,
    })

    // The engine must keep driving the animation; teardown safety must not be
    // bought by skipping the scheduling entirely.
    expect(setIntervalSpy).toHaveBeenCalled()
    expect(() => vi.advanceTimersByTime(400)).not.toThrow()
    setIntervalSpy.mockRestore()
  })
})
