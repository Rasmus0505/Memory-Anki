import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export interface ReviewFeedbackSettings {
  mode: 'immersive' | 'quiet'
  soundEnabled: boolean
  volume: number
  animationEnabled: boolean
  surpriseEnabled: boolean
}

export const REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY = 'memory-anki-review-feedback-settings-v1'
export const REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT = 'memory-anki-review-feedback-settings-change'

export const DEFAULT_REVIEW_FEEDBACK_SETTINGS: ReviewFeedbackSettings = {
  mode: 'immersive',
  soundEnabled: true,
  volume: 1.5,
  animationEnabled: true,
  surpriseEnabled: true,
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  return fallback
}

function sanitizeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}

export function sanitizeReviewFeedbackSettings(value: unknown): ReviewFeedbackSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const mode = raw.mode === 'quiet' ? 'quiet' : 'immersive'
  return {
    mode,
    soundEnabled: sanitizeBoolean(raw.soundEnabled, DEFAULT_REVIEW_FEEDBACK_SETTINGS.soundEnabled),
    volume: sanitizeNumber(raw.volume, DEFAULT_REVIEW_FEEDBACK_SETTINGS.volume, 0, 2),
    animationEnabled: sanitizeBoolean(
      raw.animationEnabled,
      DEFAULT_REVIEW_FEEDBACK_SETTINGS.animationEnabled,
    ),
    surpriseEnabled: sanitizeBoolean(
      raw.surpriseEnabled,
      DEFAULT_REVIEW_FEEDBACK_SETTINGS.surpriseEnabled,
    ),
  }
}

export function readReviewFeedbackSettings() {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY)
      if (raw) {
        return sanitizeReviewFeedbackSettings(JSON.parse(raw))
      }
    } catch {
      return DEFAULT_REVIEW_FEEDBACK_SETTINGS
    }
  }

  const cached = getCachedClientPreference(
    'review_feedback_settings',
    DEFAULT_REVIEW_FEEDBACK_SETTINGS,
    (value): value is ReviewFeedbackSettings => Boolean(value && typeof value === 'object'),
  )
  if (cached !== DEFAULT_REVIEW_FEEDBACK_SETTINGS) {
    return sanitizeReviewFeedbackSettings(cached)
  }
  return DEFAULT_REVIEW_FEEDBACK_SETTINGS
}

export function writeReviewFeedbackSettings(settings: ReviewFeedbackSettings) {
  const sanitized = sanitizeReviewFeedbackSettings(settings)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized))
    void setClientPreference('review_feedback_settings', sanitized).then((saved) => {
      window.dispatchEvent(
        new CustomEvent(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, {
          detail: saved,
        }),
      )
    })
  }
  return sanitized
}
