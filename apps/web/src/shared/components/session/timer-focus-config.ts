import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'

export type TimerFocusScene =
  | 'palace_edit'
  | 'practice'
  | 'quiz'
  | 'review'
  | 'freestyle'
  | 'english'
  | 'english_reading'

export type TimerFocusMode = 'global' | 'scene'
export type TimerFeedbackIntensity = 'balanced' | 'celebration' | 'cinematic'
export type TimerCelebrationVisualPreset =
  | 'auto'
  | 'random_direction'
  | 'realistic_look'
  | 'fireworks'
  | 'stars'
  | 'school_pride'

export interface TimerFocusRule {
  primaryMinutes: number
  secondaryMinutes: number
}

export interface TimerCelebrationEventConfig {
  enabled: boolean
  soundEnabled: boolean
  animationEnabled: boolean
  volumeBoost: number
  visualPreset: TimerCelebrationVisualPreset
}

export interface TimerFocusCelebrationConfig {
  secondaryInterval: TimerCelebrationEventConfig
  primaryGoal: TimerCelebrationEventConfig
}

export interface TimerFocusConfig {
  mode: TimerFocusMode
  feedbackIntensity: TimerFeedbackIntensity
  celebration: TimerFocusCelebrationConfig
  global: TimerFocusRule
  palace_edit: TimerFocusRule
  practice: TimerFocusRule
  quiz: TimerFocusRule
  review: TimerFocusRule
  freestyle: TimerFocusRule
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
  freestyle: '随心模式',
  english: '英语听力',
  english_reading: '英语阅读',
}

function createDefaultTimerCelebrationConfig(
  feedbackIntensity: TimerFeedbackIntensity,
): TimerFocusCelebrationConfig {
  if (feedbackIntensity === 'balanced') {
    return {
      secondaryInterval: {
        enabled: true,
        soundEnabled: true,
        animationEnabled: true,
        volumeBoost: 0.88,
        visualPreset: 'realistic_look',
      },
      primaryGoal: {
        enabled: true,
        soundEnabled: true,
        animationEnabled: true,
        volumeBoost: 0.94,
        visualPreset: 'stars',
      },
    }
  }

  if (feedbackIntensity === 'celebration') {
    return {
      secondaryInterval: {
        enabled: true,
        soundEnabled: true,
        animationEnabled: true,
        volumeBoost: 1.05,
        visualPreset: 'fireworks',
      },
      primaryGoal: {
        enabled: true,
        soundEnabled: true,
        animationEnabled: true,
        volumeBoost: 1.15,
        visualPreset: 'school_pride',
      },
    }
  }

  return {
    secondaryInterval: {
      enabled: true,
      soundEnabled: true,
      animationEnabled: true,
      volumeBoost: 1.22,
      visualPreset: 'fireworks',
    },
    primaryGoal: {
      enabled: true,
      soundEnabled: true,
      animationEnabled: true,
      volumeBoost: 1.35,
      visualPreset: 'school_pride',
    },
  }
}

export const DEFAULT_TIMER_FOCUS_CONFIG: TimerFocusConfig = {
  mode: 'global',
  feedbackIntensity: 'cinematic',
  celebration: createDefaultTimerCelebrationConfig('cinematic'),
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
  freestyle: {
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
  const requestedSecondaryMinutes = sanitizePositiveMinutes(raw.secondaryMinutes, fallback.secondaryMinutes)
  return {
    primaryMinutes,
    secondaryMinutes: Math.min(primaryMinutes, requestedSecondaryMinutes),
  }
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}

function sanitizeVisualPreset(
  value: unknown,
  fallback: TimerCelebrationVisualPreset,
): TimerCelebrationVisualPreset {
  if (
    value === 'auto' ||
    value === 'random_direction' ||
    value === 'realistic_look' ||
    value === 'fireworks' ||
    value === 'stars' ||
    value === 'school_pride'
  ) {
    return value
  }
  return fallback
}

function sanitizeCelebrationEventConfig(
  value: unknown,
  fallback: TimerCelebrationEventConfig,
): TimerCelebrationEventConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: sanitizeBoolean(raw.enabled, fallback.enabled),
    soundEnabled: sanitizeBoolean(raw.soundEnabled, fallback.soundEnabled),
    animationEnabled: sanitizeBoolean(raw.animationEnabled, fallback.animationEnabled),
    volumeBoost: sanitizeNumber(raw.volumeBoost, fallback.volumeBoost, 0, 3),
    visualPreset: sanitizeVisualPreset(raw.visualPreset, fallback.visualPreset),
  }
}

function sanitizeCelebrationConfig(
  value: unknown,
  feedbackIntensity: TimerFeedbackIntensity,
): TimerFocusCelebrationConfig {
  const fallback = createDefaultTimerCelebrationConfig(feedbackIntensity)
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    secondaryInterval: sanitizeCelebrationEventConfig(raw.secondaryInterval, fallback.secondaryInterval),
    primaryGoal: sanitizeCelebrationEventConfig(raw.primaryGoal, fallback.primaryGoal),
  }
}

export function sanitizeTimerFocusConfig(value: unknown): TimerFocusConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const legacyIntensity = raw.feedbackIntensity
  const feedbackIntensity: TimerFeedbackIntensity =
    legacyIntensity === 'balanced' || legacyIntensity === 'celebration' || legacyIntensity === 'cinematic'
      ? legacyIntensity
      : legacyIntensity === 'visual_only'
        ? 'balanced'
        : legacyIntensity === 'strong'
          ? 'celebration'
          : DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity
  return {
    mode: raw.mode === 'scene' ? 'scene' : 'global',
    feedbackIntensity,
    celebration: sanitizeCelebrationConfig(raw.celebration, feedbackIntensity),
    global: sanitizeRule(raw.global, DEFAULT_TIMER_FOCUS_CONFIG.global),
    palace_edit: sanitizeRule(raw.palace_edit, DEFAULT_TIMER_FOCUS_CONFIG.palace_edit),
    practice: sanitizeRule(raw.practice, DEFAULT_TIMER_FOCUS_CONFIG.practice),
    quiz: sanitizeRule(raw.quiz, DEFAULT_TIMER_FOCUS_CONFIG.quiz),
    review: sanitizeRule(raw.review, DEFAULT_TIMER_FOCUS_CONFIG.review),
    freestyle: sanitizeRule(raw.freestyle, DEFAULT_TIMER_FOCUS_CONFIG.freestyle),
    english: sanitizeRule(raw.english, DEFAULT_TIMER_FOCUS_CONFIG.english),
    english_reading: sanitizeRule(raw.english_reading, DEFAULT_TIMER_FOCUS_CONFIG.english_reading),
  }
}

export function readTimerFocusConfig(): TimerFocusConfig {
  const cached = getClientPreferenceCacheStatus(
    'timer_focus_config',
    (candidate): candidate is TimerFocusConfig => Boolean(candidate && typeof candidate === 'object'),
  )
  if (cached.value) return sanitizeTimerFocusConfig(cached.value)
  if (cached.hasEntry || hasLoadedClientPreferences()) return DEFAULT_TIMER_FOCUS_CONFIG

  try {
    const raw = window.localStorage.getItem(TIMER_FOCUS_STORAGE_KEY)
    if (raw) return sanitizeTimerFocusConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_TIMER_FOCUS_CONFIG
  }

  return DEFAULT_TIMER_FOCUS_CONFIG
}

function dispatchTimerFocusChange(config: TimerFocusConfig) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TIMER_FOCUS_UPDATED_EVENT, { detail: config }))
}

export function saveTimerFocusConfig(config: TimerFocusConfig) {
  const sanitized = sanitizeTimerFocusConfig(config)
  dispatchTimerFocusChange(sanitized)
  void saveClientPreference('timer_focus_config', sanitized).then((saved) => {
    dispatchTimerFocusChange(sanitizeTimerFocusConfig(saved.value))
  })
  return sanitized
}

export function resetTimerFocusConfig() {
  const nextConfig = DEFAULT_TIMER_FOCUS_CONFIG
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(TIMER_FOCUS_STORAGE_KEY)
  }
  dispatchTimerFocusChange(nextConfig)
  void saveClientPreference('timer_focus_config', nextConfig).then((saved) => {
    dispatchTimerFocusChange(sanitizeTimerFocusConfig(saved.value))
  })
  return nextConfig
}

export function getTimerFocusRule(scene: TimerFocusScene, config: TimerFocusConfig) {
  if (config.mode === 'global') return config.global
  return config[scene] ?? DEFAULT_TIMER_FOCUS_CONFIG[scene]
}

export function getTimerCelebrationConfig(kind: 'secondary' | 'primary', config: TimerFocusConfig) {
  return kind === 'secondary' ? config.celebration.secondaryInterval : config.celebration.primaryGoal
}
