import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  getTimerFocusRule,
  sanitizeTimerFocusConfig,
  TIMER_FOCUS_CONFIG_VERSION,
} from '@/shared/components/session/timer-focus-config'

describe('timer-focus-config', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps secondary minutes within primary minutes', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
      mode: 'scene',
      practice: {
        primaryMinutes: 5,
        secondaryMinutes: 9,
      },
    })

    expect(getTimerFocusRule('practice', config)).toEqual({
      primaryMinutes: 5,
      secondaryMinutes: 5,
      breakMinutes: 5,
    })
  })

  it('uses low-distraction 25/5 defaults', () => {
    expect(DEFAULT_TIMER_FOCUS_CONFIG.global).toEqual({
      primaryMinutes: 25,
      secondaryMinutes: 5,
      breakMinutes: 5,
    })
    expect(DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity).toBe('balanced')
    expect(DEFAULT_TIMER_FOCUS_CONFIG.celebration.secondaryInterval).toMatchObject({
      enabled: true,
      soundEnabled: true,
      animationEnabled: false,
    })
    expect(DEFAULT_TIMER_FOCUS_CONFIG.celebration.primaryGoal).toMatchObject({
      enabled: true,
      soundEnabled: true,
      animationEnabled: false,
      visualPreset: 'stars',
    })
  })

  it('migrates untouched legacy defaults while preserving explicit custom values', () => {
    const migrated = sanitizeTimerFocusConfig({
      mode: 'scene',
      feedbackIntensity: 'cinematic',
      global: { primaryMinutes: 25, secondaryMinutes: 1 },
      palace_edit: { primaryMinutes: 18, secondaryMinutes: 1 },
      celebration: {
        secondaryInterval: {
          enabled: true,
          soundEnabled: false,
          animationEnabled: true,
          volumeBoost: 1.22,
          visualPreset: 'fireworks',
        },
      },
    })

    expect(migrated.schemaVersion).toBe(TIMER_FOCUS_CONFIG_VERSION)
    expect(migrated.feedbackIntensity).toBe('balanced')
    expect(migrated.global).toEqual(DEFAULT_TIMER_FOCUS_CONFIG.global)
    expect(migrated.palace_edit).toEqual({ primaryMinutes: 18, secondaryMinutes: 5, breakMinutes: 5 })
    expect(migrated.celebration.secondaryInterval.soundEnabled).toBe(false)
    expect(migrated.celebration.secondaryInterval.animationEnabled).toBe(false)
  })

  it('does not reinterpret current-version values as legacy defaults', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
      feedbackIntensity: 'cinematic',
      global: { primaryMinutes: 25, secondaryMinutes: 1 },
    })

    expect(config.feedbackIntensity).toBe('cinematic')
    expect(config.global.secondaryMinutes).toBe(1)
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
      schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
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
