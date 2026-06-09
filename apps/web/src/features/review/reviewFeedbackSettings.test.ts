import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY,
  readReviewFeedbackSettings,
  sanitizeReviewFeedbackSettings,
  writeReviewFeedbackSettings,
} from '@/features/review/reviewFeedbackSettings'

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
      animationEnabled: true,
      surpriseEnabled: false,
    })

    expect(saved.mode).toBe('quiet')
    expect(saved.soundEnabled).toBe(false)
    expect(saved.volume).toBe(1.75)
    expect(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)).toContain('"mode":"quiet"')
    expect(window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)).toContain('"volume":1.75')
  })

  it('falls back to defaults for invalid values', () => {
    const sanitized = sanitizeReviewFeedbackSettings({
      mode: 'loud',
      soundEnabled: 'yes',
      volume: 'loud',
      animationEnabled: false,
      surpriseEnabled: 'sometimes',
    })

    expect(sanitized).toEqual({
      mode: 'immersive',
      soundEnabled: true,
      volume: 1.5,
      animationEnabled: false,
      surpriseEnabled: true,
    })
  })

  it('fills the default volume for legacy settings', () => {
    expect(
      sanitizeReviewFeedbackSettings({
        mode: 'quiet',
        soundEnabled: false,
        animationEnabled: true,
        surpriseEnabled: false,
      }),
    ).toEqual({
      mode: 'quiet',
      soundEnabled: false,
      volume: 1.5,
      animationEnabled: true,
      surpriseEnabled: false,
    })
  })

  it('clamps volume to the supported range', () => {
    expect(sanitizeReviewFeedbackSettings({ volume: -1 }).volume).toBe(0)
    expect(sanitizeReviewFeedbackSettings({ volume: 2.5 }).volume).toBe(2)
  })
})
