import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  readTimerFocusConfig,
  sanitizeTimerFocusConfig,
} from './timer-focus-config'

describe('timer-focus-config', () => {
  beforeEach(() => window.localStorage.clear())

  it('ships one flat round rule', () => {
    expect(readTimerFocusConfig()).toEqual({
      schemaVersion: 4,
      primaryMinutes: 25,
      secondaryMinutes: 5,
    })
  })

  it('flattens a schema v3 config, keeping the one rule that was ever effective', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: 3,
      mode: 'scene',
      feedbackIntensity: 'cinematic',
      celebration: {
        secondaryInterval: { enabled: true, volumeBoost: 1.22, visualPreset: 'fireworks' },
        primaryGoal: { enabled: true, volumeBoost: 1.3, visualPreset: 'school_pride' },
      },
      global: { primaryMinutes: 50, secondaryMinutes: 10, breakMinutes: 8 },
      // Per-scene rules were always overwritten by `global`; they must not win now.
      practice: { primaryMinutes: 5, secondaryMinutes: 1, breakMinutes: 1 },
      freestyle: { primaryMinutes: 90, secondaryMinutes: 30, breakMinutes: 20 },
    })

    expect(config).toEqual({
      schemaVersion: 4,
      primaryMinutes: 50,
      secondaryMinutes: 10,
    })
  })

  it('keeps the stage interval within one round', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: 4,
      primaryMinutes: 10,
      secondaryMinutes: 45,
    })
    expect(config.secondaryMinutes).toBe(10)
  })

  it('falls back to defaults for unusable values', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: 4,
      primaryMinutes: 0,
      secondaryMinutes: 'nope',
    })
    expect(config.primaryMinutes).toBe(DEFAULT_TIMER_FOCUS_CONFIG.primaryMinutes)
    expect(config.secondaryMinutes).toBe(DEFAULT_TIMER_FOCUS_CONFIG.secondaryMinutes)
  })
})
