import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'

/**
 * How long one round of focused study lasts.
 *
 * Schema v4 dropped `mode`, the seven per-scene rules, `feedbackIntensity` and
 * `celebration`. Sanitize had always overwritten every scene with `{...global}`
 * and forced `mode: 'global'`, so those settings could never actually differ —
 * they only produced values that were silently discarded on save. Celebration
 * strength now lives with every other feedback setting in review feedback
 * settings; break length lives with every other break setting in break guard.
 */
export interface TimerFocusConfig {
  schemaVersion?: number
  /** One round of focused study. */
  primaryMinutes: number
  /** Light checkpoint inside a round; always clamped to primaryMinutes. */
  secondaryMinutes: number
}

export const TIMER_FOCUS_STORAGE_KEY = 'memory-anki-timer-focus-config'
export const TIMER_FOCUS_UPDATED_EVENT = 'memory-anki-timer-focus-change'
export const TIMER_FOCUS_CONFIG_VERSION = 4

export const DEFAULT_TIMER_FOCUS_CONFIG: TimerFocusConfig = {
  schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
  primaryMinutes: 25,
  secondaryMinutes: 5,
}

function sanitizePositiveMinutes(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.round(parsed))
}

export function sanitizeTimerFocusConfig(value: unknown): TimerFocusConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  // Schema <= 3 nested the one effective rule under `global` and mirrored it to
  // seven scene keys that sanitize immediately overwrote.
  const legacyGlobal =
    raw.global && typeof raw.global === 'object' ? (raw.global as Record<string, unknown>) : null
  const source = legacyGlobal ?? raw

  const primaryMinutes = sanitizePositiveMinutes(
    source.primaryMinutes,
    DEFAULT_TIMER_FOCUS_CONFIG.primaryMinutes,
  )
  const secondaryMinutes = Math.min(
    primaryMinutes,
    sanitizePositiveMinutes(source.secondaryMinutes, DEFAULT_TIMER_FOCUS_CONFIG.secondaryMinutes),
  )

  return {
    schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
    primaryMinutes,
    secondaryMinutes,
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
