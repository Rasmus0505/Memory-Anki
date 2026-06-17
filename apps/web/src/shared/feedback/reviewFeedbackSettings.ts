import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export interface ReviewCelebrationEventSettings {
  enabled: boolean
  cooldownMs: number
  confettiAmount: number
  soundEnabled: boolean
  animationEnabled: boolean
}

export interface ReviewMilestoneCelebrationSettings extends ReviewCelebrationEventSettings {
  steps: number[]
}

export interface ReviewSessionCompleteCelebrationSettings {
  enabled: boolean
  confettiAmount: number
  soundEnabled: boolean
  animationEnabled: boolean
}

export interface ReviewCelebrationSettings {
  globalCooldownMs: number
  milestone: ReviewMilestoneCelebrationSettings
  branchClear: ReviewCelebrationEventSettings
  allClearReady: ReviewCelebrationEventSettings
  sessionComplete: ReviewSessionCompleteCelebrationSettings
}

export interface ReviewFeedbackSettings {
  mode: 'immersive' | 'quiet'
  soundEnabled: boolean
  volume: number
  confettiAmount: number
  animationEnabled: boolean
  surpriseEnabled: boolean
  revealFxIntensity: 'soft' | 'full'
  criticalFxIntensity: 'full' | 'cinematic'
  soundTheme: 'classic'
  globalIntensity: 'quiet' | 'balanced' | 'immersive'
  celebration: ReviewCelebrationSettings
}

export const REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY = 'memory-anki-review-feedback-settings-v1'
export const REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT = 'memory-anki-review-feedback-settings-change'

export const DEFAULT_REVIEW_MILESTONE_STEPS = [4, 8, 12, 20]

export const DEFAULT_REVIEW_FEEDBACK_SETTINGS: ReviewFeedbackSettings = {
  mode: 'immersive',
  soundEnabled: true,
  volume: 1.5,
  confettiAmount: 1.6,
  animationEnabled: true,
  surpriseEnabled: true,
  revealFxIntensity: 'full',
  criticalFxIntensity: 'cinematic',
  soundTheme: 'classic',
  globalIntensity: 'balanced',
  celebration: {
    globalCooldownMs: 5000,
    milestone: {
      enabled: true,
      steps: DEFAULT_REVIEW_MILESTONE_STEPS,
      cooldownMs: 10000,
      confettiAmount: 1.6,
      soundEnabled: true,
      animationEnabled: true,
    },
    branchClear: {
      enabled: true,
      cooldownMs: 8000,
      confettiAmount: 1.3,
      soundEnabled: true,
      animationEnabled: true,
    },
    allClearReady: {
      enabled: true,
      cooldownMs: 12000,
      confettiAmount: 1.9,
      soundEnabled: true,
      animationEnabled: true,
    },
    sessionComplete: {
      enabled: true,
      confettiAmount: 2.2,
      soundEnabled: true,
      animationEnabled: true,
    },
  },
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

function sanitizeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.round(sanitizeNumber(value, fallback, minimum, maximum))
}

function sanitizeSteps(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback
  const deduped = Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
        .map((item) => Math.round(item)),
    ),
  ).sort((a, b) => a - b)
  return deduped.length > 0 ? deduped : fallback
}

function sanitizeCelebrationEventSettings(
  value: unknown,
  fallback: ReviewCelebrationEventSettings,
  inheritedConfettiAmount: number,
  inheritedSoundEnabled: boolean,
  inheritedAnimationEnabled: boolean,
): ReviewCelebrationEventSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: sanitizeBoolean(raw.enabled, fallback.enabled),
    cooldownMs: sanitizeInteger(raw.cooldownMs, fallback.cooldownMs, 0, 120_000),
    confettiAmount: sanitizeNumber(raw.confettiAmount, inheritedConfettiAmount, 0.5, 3),
    soundEnabled: sanitizeBoolean(raw.soundEnabled, inheritedSoundEnabled),
    animationEnabled: sanitizeBoolean(raw.animationEnabled, inheritedAnimationEnabled),
  }
}

function sanitizeSessionCompleteCelebrationSettings(
  value: unknown,
  fallback: ReviewSessionCompleteCelebrationSettings,
  inheritedConfettiAmount: number,
  inheritedSoundEnabled: boolean,
  inheritedAnimationEnabled: boolean,
): ReviewSessionCompleteCelebrationSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: sanitizeBoolean(raw.enabled, fallback.enabled),
    confettiAmount: sanitizeNumber(raw.confettiAmount, inheritedConfettiAmount, 0.5, 3),
    soundEnabled: sanitizeBoolean(raw.soundEnabled, inheritedSoundEnabled),
    animationEnabled: sanitizeBoolean(raw.animationEnabled, inheritedAnimationEnabled),
  }
}

function sanitizeCelebrationSettings(
  value: unknown,
  inherited: Pick<ReviewFeedbackSettings, 'confettiAmount' | 'soundEnabled' | 'animationEnabled'>,
): ReviewCelebrationSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const fallback = DEFAULT_REVIEW_FEEDBACK_SETTINGS.celebration
  const milestoneBase = sanitizeCelebrationEventSettings(
    raw.milestone,
    fallback.milestone,
    inherited.confettiAmount,
    inherited.soundEnabled,
    inherited.animationEnabled,
  )
  const milestoneRaw =
    raw.milestone && typeof raw.milestone === 'object'
      ? (raw.milestone as Record<string, unknown>)
      : {}
  return {
    globalCooldownMs: sanitizeInteger(raw.globalCooldownMs, fallback.globalCooldownMs, 0, 120_000),
    milestone: {
      ...milestoneBase,
      steps: sanitizeSteps(milestoneRaw.steps, fallback.milestone.steps),
    },
    branchClear: sanitizeCelebrationEventSettings(
      raw.branchClear,
      fallback.branchClear,
      inherited.confettiAmount,
      inherited.soundEnabled,
      inherited.animationEnabled,
    ),
    allClearReady: sanitizeCelebrationEventSettings(
      raw.allClearReady,
      fallback.allClearReady,
      inherited.confettiAmount,
      inherited.soundEnabled,
      inherited.animationEnabled,
    ),
    sessionComplete: sanitizeSessionCompleteCelebrationSettings(
      raw.sessionComplete,
      fallback.sessionComplete,
      inherited.confettiAmount,
      inherited.soundEnabled,
      inherited.animationEnabled,
    ),
  }
}

export function sanitizeReviewFeedbackSettings(value: unknown): ReviewFeedbackSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const mode = raw.mode === 'quiet' ? 'quiet' : 'immersive'
  const globalIntensity =
    raw.globalIntensity === 'immersive' ||
    raw.globalIntensity === 'quiet' ||
    raw.globalIntensity === 'balanced'
      ? raw.globalIntensity
      : DEFAULT_REVIEW_FEEDBACK_SETTINGS.globalIntensity
  const revealFxIntensity =
    raw.revealFxIntensity === 'soft' || raw.revealFxIntensity === 'full'
      ? raw.revealFxIntensity
      : DEFAULT_REVIEW_FEEDBACK_SETTINGS.revealFxIntensity
  const criticalFxIntensity =
    raw.criticalFxIntensity === 'full' || raw.criticalFxIntensity === 'cinematic'
      ? raw.criticalFxIntensity
      : DEFAULT_REVIEW_FEEDBACK_SETTINGS.criticalFxIntensity
  const soundTheme = raw.soundTheme === 'classic' ? raw.soundTheme : DEFAULT_REVIEW_FEEDBACK_SETTINGS.soundTheme
  const soundEnabled = sanitizeBoolean(raw.soundEnabled, DEFAULT_REVIEW_FEEDBACK_SETTINGS.soundEnabled)
  const confettiAmount = sanitizeNumber(
    raw.confettiAmount,
    DEFAULT_REVIEW_FEEDBACK_SETTINGS.confettiAmount,
    0.5,
    3,
  )
  const animationEnabled = sanitizeBoolean(
    raw.animationEnabled,
    DEFAULT_REVIEW_FEEDBACK_SETTINGS.animationEnabled,
  )
  return {
    mode,
    soundEnabled,
    volume: sanitizeNumber(raw.volume, DEFAULT_REVIEW_FEEDBACK_SETTINGS.volume, 0, 2),
    confettiAmount,
    animationEnabled,
    surpriseEnabled: sanitizeBoolean(raw.surpriseEnabled, DEFAULT_REVIEW_FEEDBACK_SETTINGS.surpriseEnabled),
    revealFxIntensity,
    criticalFxIntensity,
    soundTheme,
    globalIntensity,
    celebration: sanitizeCelebrationSettings(raw.celebration, {
      confettiAmount,
      soundEnabled,
      animationEnabled,
    }),
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

