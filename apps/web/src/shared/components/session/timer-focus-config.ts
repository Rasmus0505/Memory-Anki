import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export type TimerFocusScene =
  | 'palace_edit'
  | 'practice'
  | 'quiz'
  | 'review'
  | 'english'
  | 'english_reading'

export type TimerFocusMode = 'global' | 'scene'
export type TimerFeedbackIntensity = 'extreme' | 'strong' | 'visual_only'

export interface TimerFocusRule {
  primaryMinutes: number
  secondaryMinutes: number
}

export interface TimerFocusConfig {
  mode: TimerFocusMode
  feedbackIntensity: TimerFeedbackIntensity
  global: TimerFocusRule
  palace_edit: TimerFocusRule
  practice: TimerFocusRule
  quiz: TimerFocusRule
  review: TimerFocusRule
  english: TimerFocusRule
  english_reading: TimerFocusRule
}

export const TIMER_FOCUS_STORAGE_KEY = 'memory-anki-timer-focus-config'
export const TIMER_FOCUS_UPDATED_EVENT = 'memory-anki-timer-focus-change'

export const TIMER_FOCUS_SCENE_LABELS: Record<TimerFocusScene, string> = {
  palace_edit: '编辑',
  practice: '练习',
  quiz: '做题',
  review: '复习',
  english: '英语听力',
  english_reading: '英语阅读',
}

export const DEFAULT_TIMER_FOCUS_CONFIG: TimerFocusConfig = {
  mode: 'global',
  feedbackIntensity: 'extreme',
  global: {
    primaryMinutes: 25,
    secondaryMinutes: 1,
  },
  palace_edit: {
    primaryMinutes: 20,
    secondaryMinutes: 1,
  },
  practice: {
    primaryMinutes: 25,
    secondaryMinutes: 1,
  },
  quiz: {
    primaryMinutes: 20,
    secondaryMinutes: 1,
  },
  review: {
    primaryMinutes: 25,
    secondaryMinutes: 1,
  },
  english: {
    primaryMinutes: 15,
    secondaryMinutes: 1,
  },
  english_reading: {
    primaryMinutes: 30,
    secondaryMinutes: 2,
  },
}

function sanitizePositiveMinutes(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.round(parsed))
}

function sanitizeRule(value: unknown, fallback: TimerFocusRule): TimerFocusRule {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const primaryMinutes = sanitizePositiveMinutes(raw.primaryMinutes, fallback.primaryMinutes)
  const requestedSecondaryMinutes = sanitizePositiveMinutes(
    raw.secondaryMinutes,
    fallback.secondaryMinutes,
  )
  return {
    primaryMinutes,
    secondaryMinutes: Math.min(primaryMinutes, requestedSecondaryMinutes),
  }
}

export function sanitizeTimerFocusConfig(value: unknown): TimerFocusConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    mode: raw.mode === 'scene' ? 'scene' : 'global',
    feedbackIntensity:
      raw.feedbackIntensity === 'visual_only' || raw.feedbackIntensity === 'strong'
        ? raw.feedbackIntensity
        : DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity,
    global: sanitizeRule(raw.global, DEFAULT_TIMER_FOCUS_CONFIG.global),
    palace_edit: sanitizeRule(raw.palace_edit, DEFAULT_TIMER_FOCUS_CONFIG.palace_edit),
    practice: sanitizeRule(raw.practice, DEFAULT_TIMER_FOCUS_CONFIG.practice),
    quiz: sanitizeRule(raw.quiz, DEFAULT_TIMER_FOCUS_CONFIG.quiz),
    review: sanitizeRule(raw.review, DEFAULT_TIMER_FOCUS_CONFIG.review),
    english: sanitizeRule(raw.english, DEFAULT_TIMER_FOCUS_CONFIG.english),
    english_reading: sanitizeRule(raw.english_reading, DEFAULT_TIMER_FOCUS_CONFIG.english_reading),
  }
}

export function readTimerFocusConfig(): TimerFocusConfig {
  try {
    const raw = window.localStorage.getItem(TIMER_FOCUS_STORAGE_KEY)
    if (raw) {
      return sanitizeTimerFocusConfig(JSON.parse(raw))
    }
  } catch {
    return DEFAULT_TIMER_FOCUS_CONFIG
  }

  const cached = getCachedClientPreference(
    'timer_focus_config',
    DEFAULT_TIMER_FOCUS_CONFIG,
    (candidate): candidate is TimerFocusConfig => Boolean(candidate && typeof candidate === 'object'),
  )
  if (cached !== DEFAULT_TIMER_FOCUS_CONFIG) {
    return sanitizeTimerFocusConfig(cached)
  }
  return DEFAULT_TIMER_FOCUS_CONFIG
}

function dispatchTimerFocusChange(config: TimerFocusConfig) {
  window.dispatchEvent(new CustomEvent(TIMER_FOCUS_UPDATED_EVENT, { detail: config }))
}

export function saveTimerFocusConfig(config: TimerFocusConfig) {
  const sanitized = sanitizeTimerFocusConfig(config)
  window.localStorage.setItem(TIMER_FOCUS_STORAGE_KEY, JSON.stringify(sanitized))
  void setClientPreference('timer_focus_config', sanitized).then((saved) => {
    dispatchTimerFocusChange(sanitizeTimerFocusConfig(saved))
  })
  return sanitized
}

export function resetTimerFocusConfig() {
  const nextConfig = DEFAULT_TIMER_FOCUS_CONFIG
  window.localStorage.removeItem(TIMER_FOCUS_STORAGE_KEY)
  void setClientPreference('timer_focus_config', nextConfig).then((saved) => {
    dispatchTimerFocusChange(sanitizeTimerFocusConfig(saved))
  })
  return nextConfig
}

export function getTimerFocusRule(
  scene: TimerFocusScene,
  config: TimerFocusConfig,
) {
  if (config.mode === 'global') {
    return config.global
  }
  return config[scene] ?? DEFAULT_TIMER_FOCUS_CONFIG[scene]
}
