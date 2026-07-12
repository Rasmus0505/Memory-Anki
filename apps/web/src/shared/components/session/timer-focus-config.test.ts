import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  getTimerFocusRule,
  sanitizeTimerFocusConfig,
} from './timer-focus-config'

describe('timer-focus-config', () => {
  it('uses the 25/5/5 global default', () => {
    expect(DEFAULT_TIMER_FOCUS_CONFIG.global).toEqual({
      primaryMinutes: 25,
      secondaryMinutes: 5,
      breakMinutes: 5,
    })
  })

  it('caps reminders and copies the global rule to all scenes', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: 3,
      global: { primaryMinutes: 5, secondaryMinutes: 9, breakMinutes: 3 },
    })
    expect(getTimerFocusRule('practice', config)).toEqual({
      primaryMinutes: 5,
      secondaryMinutes: 5,
      breakMinutes: 3,
    })
    expect(config.english_reading).toEqual(config.global)
  })

  it('migrates from the old global rule and keeps feedback settings', () => {
    const config = sanitizeTimerFocusConfig({
      schemaVersion: 2,
      mode: 'scene',
      global: { primaryMinutes: 18, secondaryMinutes: 6, breakMinutes: 4 },
      feedbackIntensity: 'celebration',
    })
    expect(config.mode).toBe('global')
    expect(config.global).toEqual({ primaryMinutes: 18, secondaryMinutes: 6, breakMinutes: 4 })
    expect(config.practice).toEqual(config.global)
    expect(config.feedbackIntensity).toBe('celebration')
  })
})
