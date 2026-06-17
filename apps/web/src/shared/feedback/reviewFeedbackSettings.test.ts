import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
  readReviewFeedbackSettings,
  sanitizeReviewFeedbackSettings,
  writeReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

describe('reviewFeedbackSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readReviewFeedbackSettings()).toEqual(DEFAULT_REVIEW_FEEDBACK_SETTINGS)
  })

  it('writes sanitized settings to localStorage', () => {
    const saved = writeReviewFeedbackSettings({
      mode: 'quiet',
      soundEnabled: false,
      volume: 1.75,
      confettiAmount: 2.4,
      animationEnabled: true,
      surpriseEnabled: false,
      revealFxIntensity: 'soft',
      criticalFxIntensity: 'full',
      soundTheme: 'classic',
      globalIntensity: 'balanced',
      celebration: {
        globalCooldownMs: 3000,
        milestone: {
          enabled: true,
          steps: [4, 8, 12],
          cooldownMs: 8000,
          confettiAmount: 1.9,
          soundEnabled: false,
          animationEnabled: true,
        },
        branchClear: {
          enabled: false,
          cooldownMs: 6000,
          confettiAmount: 1.4,
          soundEnabled: false,
          animationEnabled: true,
        },
        allClearReady: {
          enabled: true,
          cooldownMs: 12000,
          confettiAmount: 2.2,
          soundEnabled: true,
          animationEnabled: false,
        },
        sessionComplete: {
          enabled: true,
          confettiAmount: 2.5,
          soundEnabled: true,
          animationEnabled: true,
        },
      },
    })

    expect(saved.mode).toBe('quiet')
    expect(saved.soundEnabled).toBe(false)
    expect(saved.volume).toBe(1.75)
    expect(saved.confettiAmount).toBe(2.4)
    expect(saved.globalIntensity).toBe('balanced')
    expect(saved.celebration.globalCooldownMs).toBe(3000)
    expect(saved.celebration.milestone.steps).toEqual([4, 8, 12])
    expect(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)).toContain('"mode":"quiet"')
    expect(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)).toContain('"volume":1.75')
    expect(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)).toContain('"confettiAmount":2.4')
  })

  it('falls back to defaults for invalid values and sanitizes celebration settings', () => {
    const sanitized = sanitizeReviewFeedbackSettings({
      mode: 'loud',
      soundEnabled: 'yes',
      volume: 'loud',
      confettiAmount: 'huge',
      animationEnabled: false,
      surpriseEnabled: 'sometimes',
      revealFxIntensity: 'max',
      criticalFxIntensity: 'nope',
      soundTheme: 'retro',
      globalIntensity: 'nope',
      celebration: {
        globalCooldownMs: -10,
        milestone: {
          steps: ['x', -4, 12, 12, 6],
          cooldownMs: -20,
        },
      },
    })

    expect(sanitized).toEqual({
      mode: 'immersive',
      soundEnabled: true,
      volume: 1.5,
      confettiAmount: 1.6,
      animationEnabled: false,
      surpriseEnabled: true,
      revealFxIntensity: 'full',
      criticalFxIntensity: 'cinematic',
      soundTheme: 'classic',
      globalIntensity: 'balanced',
      celebration: {
        globalCooldownMs: 0,
        milestone: {
          enabled: true,
          steps: [6, 12],
          cooldownMs: 0,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: false,
        },
        branchClear: {
          enabled: true,
          cooldownMs: 8000,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: false,
        },
        allClearReady: {
          enabled: true,
          cooldownMs: 12000,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: false,
        },
        sessionComplete: {
          enabled: true,
          confettiAmount: 1.6,
          soundEnabled: true,
          animationEnabled: false,
        },
      },
    })
  })

  it('fills the default volume and migrates legacy settings into celebrations', () => {
    expect(
      sanitizeReviewFeedbackSettings({
        mode: 'quiet',
        soundEnabled: false,
        animationEnabled: true,
        surpriseEnabled: false,
        confettiAmount: 1.6,
      }),
    ).toEqual({
      mode: 'quiet',
      soundEnabled: false,
      volume: 1.5,
      confettiAmount: 1.6,
      animationEnabled: true,
      surpriseEnabled: false,
      revealFxIntensity: 'full',
      criticalFxIntensity: 'cinematic',
      soundTheme: 'classic',
      globalIntensity: 'balanced',
      celebration: {
        globalCooldownMs: 5000,
        milestone: {
          enabled: true,
          steps: [4, 8, 12, 20],
          cooldownMs: 10000,
          confettiAmount: 1.6,
          soundEnabled: false,
          animationEnabled: true,
        },
        branchClear: {
          enabled: true,
          cooldownMs: 8000,
          confettiAmount: 1.6,
          soundEnabled: false,
          animationEnabled: true,
        },
        allClearReady: {
          enabled: true,
          cooldownMs: 12000,
          confettiAmount: 1.6,
          soundEnabled: false,
          animationEnabled: true,
        },
        sessionComplete: {
          enabled: true,
          confettiAmount: 1.6,
          soundEnabled: false,
          animationEnabled: true,
        },
      },
    })
  })

  it('clamps volume to the supported range', () => {
    expect(sanitizeReviewFeedbackSettings({ volume: -1 }).volume).toBe(0)
    expect(sanitizeReviewFeedbackSettings({ volume: 2.5 }).volume).toBe(2)
  })

  it('clamps confetti amount to the supported range', () => {
    expect(sanitizeReviewFeedbackSettings({ confettiAmount: 0.1 }).confettiAmount).toBe(0.5)
    expect(sanitizeReviewFeedbackSettings({ confettiAmount: 3.5 }).confettiAmount).toBe(3)
  })

  it('migrates legacy confetti and sound settings into event celebrations', () => {
    const sanitized = sanitizeReviewFeedbackSettings({
      soundEnabled: false,
      animationEnabled: true,
      confettiAmount: 2.3,
    })

    expect(sanitized.celebration.milestone.confettiAmount).toBe(2.3)
    expect(sanitized.celebration.branchClear.confettiAmount).toBe(2.3)
    expect(sanitized.celebration.allClearReady.confettiAmount).toBe(2.3)
    expect(sanitized.celebration.sessionComplete.confettiAmount).toBe(2.3)
    expect(sanitized.celebration.milestone.soundEnabled).toBe(false)
    expect(sanitized.celebration.branchClear.soundEnabled).toBe(false)
  })
})
