import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  getTimerFocusRule,
  sanitizeTimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'

describe('timer-focus-config', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps secondary minutes within primary minutes', () => {
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

  it('maps legacy intensity values to stronger timer-first defaults', () => {
    const balanced = sanitizeTimerFocusConfig({ feedbackIntensity: 'visual_only' })
    const celebration = sanitizeTimerFocusConfig({ feedbackIntensity: 'strong' })

    expect(balanced.feedbackIntensity).toBe('balanced')
    expect(celebration.feedbackIntensity).toBe('celebration')
    expect(celebration.celebration.primaryGoal.volumeBoost).toBeGreaterThan(
      balanced.celebration.primaryGoal.volumeBoost,
    )
  })

  it('keeps explicit event-level celebration settings when present', () => {
    const config = sanitizeTimerFocusConfig({
      feedbackIntensity: 'cinematic',
      celebration: {
        secondaryInterval: {
          enabled: false,
          soundEnabled: true,
          animationEnabled: false,
          volumeBoost: 1.35,
          visualPreset: 'fireworks',
        },
        primaryGoal: {
          enabled: true,
          soundEnabled: true,
          animationEnabled: true,
          volumeBoost: 1.8,
          visualPreset: 'school_pride',
        },
      },
    })

    expect(config.celebration.secondaryInterval).toEqual({
      enabled: false,
      soundEnabled: true,
      animationEnabled: false,
      volumeBoost: 1.35,
      visualPreset: 'fireworks',
    })
    expect(config.celebration.primaryGoal.visualPreset).toBe('school_pride')
  })

  it('falls back to defaults for invalid values', () => {
    const config = sanitizeTimerFocusConfig({
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
