import type { SessionKind } from '@/modules/session/public'

import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'

export type TimerAutomationScene = SessionKind | 'freestyle' | 'english' | 'english_reading'

/**
 * One flat rule for every study page.
 *
 * Schema v4 dropped the per-scene rules and the `mode` switch: v3 already
 * collapsed them to a single shared rule during sanitize, so the extra shape
 * only ever produced settings that were silently discarded on save.
 */
export interface TimerAutomationConfig {
  schemaVersion?: number
  /** Start counting as soon as a study page mounts. */
  autoStartOnPageEnter: boolean
  /**
   * Hold a screen wake lock while a timer runs. Lives here rather than with
   * feedback settings: a phone that dims mid-recitation hides the page and
   * suspends the timer, so this is a timing rule, not a way of responding.
   */
  keepScreenAwake: boolean
  /** How long without a click still counts as studying (silent recitation). */
  idleTimeoutSeconds: number
  /**
   * "Still studying?" window shown after {@link idleTimeoutSeconds}. Any
   * activity within it keeps the timer running; otherwise the timer pauses and
   * rolls back exactly this many seconds — the stretch that was warned about
   * and ignored. Rollback is deliberately not a separate knob.
   */
  idleGraceSeconds: number
  /** Debounce before backgrounding the app leaves the scene. 0 = pause at once. */
  backgroundGraceSeconds: number
}

export type TimerAutomationActivityKind =
  | 'window_return'
  | 'node_switch'
  | 'edit_operation'
  | 'practice_interaction'

/**
 * Which signals renew the idle countdown. Fixed rather than configurable:
 * returning to the window is not evidence of studying, and node switches fire
 * from programmatic navigation too.
 */
const ACTIVITY_ENABLED: Readonly<Record<TimerAutomationActivityKind, boolean>> = Object.freeze({
  window_return: false,
  node_switch: false,
  edit_operation: true,
  practice_interaction: true,
})

export const TIMER_AUTOMATION_STORAGE_KEY = 'memory-anki-timer-automation-config'
export const TIMER_AUTOMATION_UPDATED_EVENT = APP_EVENT_NAMES.timerAutomationUpdated
export const TIMER_AUTOMATION_CONFIG_VERSION = 5

export const DEFAULT_TIMER_AUTOMATION_CONFIG: TimerAutomationConfig = {
  schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
  autoStartOnPageEnter: false,
  keepScreenAwake: true,
  idleTimeoutSeconds: 120,
  idleGraceSeconds: 30,
  backgroundGraceSeconds: 20,
}

function sanitizeSeconds(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round(parsed)
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  return fallback
}

export function sanitizeTimerAutomationConfig(value: unknown): TimerAutomationConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  // Schema <= 3 nested everything under `shared` plus one key per scene.
  const legacyShared =
    raw.shared && typeof raw.shared === 'object' ? (raw.shared as Record<string, unknown>) : null
  const legacyActions =
    raw.actions && typeof raw.actions === 'object' ? (raw.actions as Record<string, unknown>) : null

  if (legacyShared) {
    return {
      schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
      autoStartOnPageEnter: sanitizeBoolean(
        legacyShared.autoStartOnPageEnter ?? legacyActions?.autoStartOnPageEnter,
        DEFAULT_TIMER_AUTOMATION_CONFIG.autoStartOnPageEnter,
      ),
      // Carried over from review feedback settings by timerConfigMigration.
      keepScreenAwake: sanitizeBoolean(
        raw.keepScreenAwake,
        DEFAULT_TIMER_AUTOMATION_CONFIG.keepScreenAwake,
      ),
      idleTimeoutSeconds: sanitizeSeconds(
        legacyShared.inactiveAutoPauseSeconds,
        DEFAULT_TIMER_AUTOMATION_CONFIG.idleTimeoutSeconds,
      ),
      // Deliberately ignore the stored grace/hidden values: v3 sanitize forced
      // both to 0, which is exactly the behaviour this schema bump fixes.
      idleGraceSeconds: DEFAULT_TIMER_AUTOMATION_CONFIG.idleGraceSeconds,
      backgroundGraceSeconds: DEFAULT_TIMER_AUTOMATION_CONFIG.backgroundGraceSeconds,
    }
  }

  return {
    schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
    autoStartOnPageEnter: sanitizeBoolean(
      raw.autoStartOnPageEnter,
      DEFAULT_TIMER_AUTOMATION_CONFIG.autoStartOnPageEnter,
    ),
    keepScreenAwake: sanitizeBoolean(
      raw.keepScreenAwake,
      DEFAULT_TIMER_AUTOMATION_CONFIG.keepScreenAwake,
    ),
    idleTimeoutSeconds: sanitizeSeconds(
      raw.idleTimeoutSeconds,
      DEFAULT_TIMER_AUTOMATION_CONFIG.idleTimeoutSeconds,
    ),
    idleGraceSeconds: sanitizeSeconds(
      raw.idleGraceSeconds,
      DEFAULT_TIMER_AUTOMATION_CONFIG.idleGraceSeconds,
    ),
    backgroundGraceSeconds: sanitizeSeconds(
      raw.backgroundGraceSeconds,
      DEFAULT_TIMER_AUTOMATION_CONFIG.backgroundGraceSeconds,
    ),
  }
}

export function readTimerAutomationConfig(): TimerAutomationConfig {
  const cached = getClientPreferenceCacheStatus(
    'timer_automation_config',
    (value): value is TimerAutomationConfig => Boolean(value && typeof value === 'object'),
  )
  if (cached.value) {
    return sanitizeTimerAutomationConfig(cached.value)
  }
  if (cached.hasEntry || hasLoadedClientPreferences()) {
    return DEFAULT_TIMER_AUTOMATION_CONFIG
  }

  try {
    const raw = window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)
    if (raw) {
      return sanitizeTimerAutomationConfig(JSON.parse(raw))
    }
  } catch {
    return DEFAULT_TIMER_AUTOMATION_CONFIG
  }

  return DEFAULT_TIMER_AUTOMATION_CONFIG
}

function dispatchTimerAutomationChange(config: TimerAutomationConfig) {
  emitAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, config)
}

export function saveTimerAutomationConfig(config: TimerAutomationConfig) {
  const sanitized = sanitizeTimerAutomationConfig(config)
  dispatchTimerAutomationChange(sanitized)
  void saveClientPreference('timer_automation_config', sanitized).then((saved) => {
    dispatchTimerAutomationChange(sanitizeTimerAutomationConfig(saved.value))
  })
  return sanitized
}

export function resetTimerAutomationConfig() {
  const nextConfig = DEFAULT_TIMER_AUTOMATION_CONFIG
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(TIMER_AUTOMATION_STORAGE_KEY)
  }
  dispatchTimerAutomationChange(nextConfig)
  void saveClientPreference('timer_automation_config', nextConfig).then((saved) => {
    dispatchTimerAutomationChange(sanitizeTimerAutomationConfig(saved.value))
  })
  return nextConfig
}

export function isActivityEnabled(kind: TimerAutomationActivityKind) {
  return ACTIVITY_ENABLED[kind] ?? false
}

export function shouldAutoStartOnPageEnter(config: TimerAutomationConfig) {
  return config.autoStartOnPageEnter
}
