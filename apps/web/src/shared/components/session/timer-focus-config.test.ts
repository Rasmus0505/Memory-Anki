import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  getTimerFocusRule,
  sanitizeTimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'

describe('timer focus config', () => {
  it('uses the global rule for every scene in global mode', () => {
    const config = sanitizeTimerFocusConfig({
      mode: 'global',
      global: {
        primaryMinutes: 30,
        secondaryMinutes: 2,
      },
      practice: {
        primaryMinutes: 10,
        secondaryMinutes: 1,
      },
    })

    expect(getTimerFocusRule('practice', config)).toEqual({
      primaryMinutes: 30,
      secondaryMinutes: 2,
    })
    expect(getTimerFocusRule('english_reading', config)).toEqual({
      primaryMinutes: 30,
      secondaryMinutes: 2,
    })
  })

  it('keeps scene-specific rules in scene mode', () => {
    const config = sanitizeTimerFocusConfig({
      mode: 'scene',
      practice: {
        primaryMinutes: 18,
        secondaryMinutes: 1,
      },
      quiz: {
        primaryMinutes: 12,
        secondaryMinutes: 2,
      },
    })

    expect(getTimerFocusRule('practice', config)).toEqual({
      primaryMinutes: 18,
      secondaryMinutes: 1,
    })
    expect(getTimerFocusRule('quiz', config)).toEqual({
      primaryMinutes: 12,
      secondaryMinutes: 2,
    })
  })

  it('clamps the secondary target so it cannot exceed the primary target', () => {
    const config = sanitizeTimerFocusConfig({
      mode: 'scene',
      practice: {
        primaryMinutes: 5,
        secondaryMinutes: 9,
      },
    })

    expect(getTimerFocusRule('practice', config)).toEqual({
      primaryMinutes: 5,
      secondaryMinutes: 5,
    })
  })

  it('falls back to defaults for invalid values', () => {
    const config = sanitizeTimerFocusConfig({
      mode: 'scene',
      feedbackIntensity: 'bogus',
      practice: {
        primaryMinutes: 0,
        secondaryMinutes: -1,
      },
    })

    expect(config.feedbackIntensity).toBe(DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity)
    expect(getTimerFocusRule('practice', config)).toEqual(DEFAULT_TIMER_FOCUS_CONFIG.practice)
  })
})
