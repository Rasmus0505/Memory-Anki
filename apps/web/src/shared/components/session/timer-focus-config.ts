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
  breakMinutes?: number
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
  schemaVersion?: number
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
export const TIMER_FOCUS_CONFIG_VERSION = 3

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
        animationEnabled: false,
        volumeBoost: 0.75,
        visualPreset: 'stars',
      },
      primaryGoal: {
        enabled: true,
        soundEnabled: true,
        animationEnabled: false,
        volumeBoost: 0.9,
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

const LEGACY_DEFAULT_TIMER_FOCUS_CONFIG = {
  feedbackIntensity: 'cinematic' as const,
  celebration: createDefaultTimerCelebrationConfig('cinematic'),
  global: { primaryMinutes: 25, secondaryMinutes: 1 },
  palace_edit: { primaryMinutes: 20, secondaryMinutes: 1 },
  practice: { primaryMinutes: 25, secondaryMinutes: 1 },
  quiz: { primaryMinutes: 20, secondaryMinutes: 1 },
  review: { primaryMinutes: 25, secondaryMinutes: 1 },
  freestyle: { primaryMinutes: 25, secondaryMinutes: 1 },
  english: { primaryMinutes: 15, secondaryMinutes: 1 },
  english_reading: { primaryMinutes: 30, secondaryMinutes: 2 },
} satisfies Pick<
  TimerFocusConfig,
  | 'feedbackIntensity'
  | 'celebration'
  | 'global'
  | TimerFocusScene
>

export const DEFAULT_TIMER_FOCUS_CONFIG: TimerFocusConfig = {
  schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
  mode: 'global',
  feedbackIntensity: 'balanced',
  celebration: createDefaultTimerCelebrationConfig('balanced'),
  global: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  palace_edit: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  practice: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  quiz: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  review: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  freestyle: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  english: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
  english_reading: {
    primaryMinutes: 25,
    secondaryMinutes: 5,
    breakMinutes: 5,
  },
}

function sanitizePositiveMinutes(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.round(parsed))
}

function migrateLegacyField<T>(
  value: unknown,
  legacyDefault: T,
  currentDefault: T,
  isLegacyConfig: boolean,
) {
  if (!isLegacyConfig || value !== legacyDefault) return value
  return currentDefault
}

function sanitizeRule(
  value: unknown,
  fallback: TimerFocusRule,
  legacyFallback: TimerFocusRule,
  isLegacyConfig: boolean,
): TimerFocusRule {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const primaryMinutes = sanitizePositiveMinutes(
    migrateLegacyField(
      raw.primaryMinutes,
      legacyFallback.primaryMinutes,
      fallback.primaryMinutes,
      isLegacyConfig,
    ),
    fallback.primaryMinutes,
  )
  const requestedSecondaryMinutes = sanitizePositiveMinutes(
    migrateLegacyField(
      raw.secondaryMinutes,
      legacyFallback.secondaryMinutes,
      fallback.secondaryMinutes,
      isLegacyConfig,
    ),
    fallback.secondaryMinutes,
  )
  return {
    primaryMinutes,
    secondaryMinutes: Math.min(primaryMinutes, requestedSecondaryMinutes),
    breakMinutes: sanitizePositiveMinutes(raw.breakMinutes, fallback.breakMinutes ?? 5),
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
  legacyFallback: TimerCelebrationEventConfig,
  isLegacyConfig: boolean,
): TimerCelebrationEventConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: sanitizeBoolean(
      migrateLegacyField(raw.enabled, legacyFallback.enabled, fallback.enabled, isLegacyConfig),
      fallback.enabled,
    ),
    soundEnabled: sanitizeBoolean(
      migrateLegacyField(
        raw.soundEnabled,
        legacyFallback.soundEnabled,
        fallback.soundEnabled,
        isLegacyConfig,
      ),
      fallback.soundEnabled,
    ),
    animationEnabled: sanitizeBoolean(
      migrateLegacyField(
        raw.animationEnabled,
        legacyFallback.animationEnabled,
        fallback.animationEnabled,
        isLegacyConfig,
      ),
      fallback.animationEnabled,
    ),
    volumeBoost: sanitizeNumber(
      migrateLegacyField(
        raw.volumeBoost,
        legacyFallback.volumeBoost,
        fallback.volumeBoost,
        isLegacyConfig,
      ),
      fallback.volumeBoost,
      0,
      3,
    ),
    visualPreset: sanitizeVisualPreset(
      migrateLegacyField(
        raw.visualPreset,
        legacyFallback.visualPreset,
        fallback.visualPreset,
        isLegacyConfig,
      ),
      fallback.visualPreset,
    ),
  }
}

function sanitizeCelebrationConfig(
  value: unknown,
  feedbackIntensity: TimerFeedbackIntensity,
  legacyFeedbackIntensity: TimerFeedbackIntensity,
  isLegacyConfig: boolean,
): TimerFocusCelebrationConfig {
  const fallback = createDefaultTimerCelebrationConfig(feedbackIntensity)
  const legacyFallback = createLegacyTimerCelebrationConfig(legacyFeedbackIntensity)
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    secondaryInterval: sanitizeCelebrationEventConfig(
      raw.secondaryInterval,
      fallback.secondaryInterval,
      legacyFallback.secondaryInterval,
      isLegacyConfig,
    ),
    primaryGoal: sanitizeCelebrationEventConfig(
      raw.primaryGoal,
      fallback.primaryGoal,
      legacyFallback.primaryGoal,
      isLegacyConfig,
    ),
  }
}

function createLegacyTimerCelebrationConfig(
  feedbackIntensity: TimerFeedbackIntensity,
): TimerFocusCelebrationConfig {
  if (feedbackIntensity !== 'balanced') {
    return createDefaultTimerCelebrationConfig(feedbackIntensity)
  }
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

function sanitizeFeedbackIntensity(value: unknown): TimerFeedbackIntensity | undefined {
  if (value === 'balanced' || value === 'celebration' || value === 'cinematic') return value
  if (value === 'visual_only') return 'balanced'
  if (value === 'strong') return 'celebration'
  return undefined
}

export function sanitizeTimerFocusConfig(value: unknown): TimerFocusConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const schemaVersion = sanitizeNumber(raw.schemaVersion, 1, 1, TIMER_FOCUS_CONFIG_VERSION)
  const isLegacyConfig = schemaVersion < TIMER_FOCUS_CONFIG_VERSION
  const legacyFeedbackIntensity =
    sanitizeFeedbackIntensity(raw.feedbackIntensity) ?? LEGACY_DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity
  const requestedFeedbackIntensity = sanitizeFeedbackIntensity(
    migrateLegacyField(
      legacyFeedbackIntensity,
      LEGACY_DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity,
      DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity,
      isLegacyConfig,
    ),
  )
  const feedbackIntensity = requestedFeedbackIntensity ?? DEFAULT_TIMER_FOCUS_CONFIG.feedbackIntensity
  const global = sanitizeRule(
    raw.global,
    DEFAULT_TIMER_FOCUS_CONFIG.global,
    LEGACY_DEFAULT_TIMER_FOCUS_CONFIG.global,
    isLegacyConfig,
  )
  return {
    schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
    mode: 'global',
    feedbackIntensity,
    celebration: sanitizeCelebrationConfig(
      raw.celebration,
      feedbackIntensity,
      legacyFeedbackIntensity,
      isLegacyConfig,
    ),
    global,
    palace_edit: { ...global },
    practice: { ...global },
    quiz: { ...global },
    review: { ...global },
    freestyle: { ...global },
    english: { ...global },
    english_reading: { ...global },
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
