import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'

/** One flat rule for every study page. */
export interface TimerAutomationConfig {
  schemaVersion: number
  /** Start counting as soon as a study page mounts. */
  autoStartOnPageEnter: boolean
  /**
   * Hold a screen wake lock while a timer runs. Lives here rather than with
   * feedback settings: a phone that dims mid-recitation hides the page and
   * suspends the timer, so this is a timing rule, not a way of responding.
   */
  keepScreenAwake: boolean
  /** @deprecated Ignored. Idle automation was removed in schema v6. */
  idleTimeoutSeconds?: number
  /** @deprecated Ignored. Idle automation was removed in schema v6. */
  idleGraceSeconds?: number
  /** @deprecated Ignored. Background grace was removed in schema v6. */
  backgroundGraceSeconds?: number
}

/** @deprecated Activity renewal is no longer part of timer automation. */
export type TimerAutomationActivityKind =
  | 'window_return'
  | 'node_switch'
  | 'edit_operation'
  | 'practice_interaction'

export const TIMER_AUTOMATION_STORAGE_KEY = 'memory-anki-timer-automation-config'
export const TIMER_AUTOMATION_UPDATED_EVENT = APP_EVENT_NAMES.timerAutomationUpdated
export const TIMER_AUTOMATION_CONFIG_VERSION = 6

export const DEFAULT_TIMER_AUTOMATION_CONFIG: TimerAutomationConfig = {
  schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
  autoStartOnPageEnter: false,
  keepScreenAwake: true,
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

export function shouldAutoStartOnPageEnter(config: TimerAutomationConfig) {
  return config.autoStartOnPageEnter
}

/** @deprecated Kept for old callers; every activity signal is ignored. */
export function isActivityEnabled(_kind: TimerAutomationActivityKind) {
  return false
}
