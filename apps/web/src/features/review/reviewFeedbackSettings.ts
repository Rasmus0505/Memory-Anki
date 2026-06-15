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
  /**
   * 控制全局通用 UI 反馈（普通点击 / 悬停 / 打字等 DOM 原生事件）的强度。
   * 不影响脑图编辑与复习流程中通过 dispatchGlobalFeedback 主动派发的反馈。
   * - 'immersive'：全开（每个点击/悬停都有粒子与声音）
   * - 'balanced'（默认）：仅语义明确的操作有声，普通微操作仅视觉、默认无声，悬停默认关闭
   * - 'quiet'：通用 UI 反馈静默
   */
  globalIntensity: 'quiet' | 'balanced' | 'immersive'
}

export const REVIEW_FEEDBACK_SETTINGS_STORAGE_KEY = 'memory-anki-review-feedback-settings-v1'
export const REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT = 'memory-anki-review-feedback-settings-change'

export const DEFAULT_REVIEW_FEEDBACK_SETTINGS: ReviewFeedbackSettings = {
  mode: 'immersive',
  soundEnabled: true,
  volume: 1.5,
  animationEnabled: true,
  surpriseEnabled: true,
  globalIntensity: 'balanced',
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
  const globalIntensity =
    raw.globalIntensity === 'immersive' || raw.globalIntensity === 'quiet' || raw.globalIntensity === 'balanced'
      ? raw.globalIntensity
      : DEFAULT_REVIEW_FEEDBACK_SETTINGS.globalIntensity
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
    globalIntensity,
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
