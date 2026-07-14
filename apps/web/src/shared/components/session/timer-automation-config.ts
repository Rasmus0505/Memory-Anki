import type { SessionKind } from '@/entities/session/model'

import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'

export type TimerAutomationScene = SessionKind | 'freestyle' | 'english' | 'english_reading'
export type TimerAutomationMode = 'scene' | 'global'

export interface TimerAutomationRule {
  autoStartOnPageEnter: boolean
  inactiveAutoPauseSeconds: number
  inactivePauseGraceSeconds?: number
  hiddenAutoPauseSeconds: number
  autoPauseRollbackSeconds: number
}

export interface TimerAutomationActivityConfig {
  autoResumeOnWindowReturn: boolean
  countNodeSwitchAsActivity: boolean
  countEditOperationsAsActivity: boolean
  countPracticeInteractionsAsActivity: boolean
}

export interface TimerAutomationConfig {
  schemaVersion?: number
  mode: TimerAutomationMode
  actions: TimerAutomationActivityConfig
  shared: TimerAutomationRule
  palace_edit: TimerAutomationRule
  practice: TimerAutomationRule
  quiz: TimerAutomationRule
  review: TimerAutomationRule
  freestyle: TimerAutomationRule
  english: TimerAutomationRule
  english_reading: TimerAutomationRule
}

export type TimerAutomationActivityKind =
  | 'window_return'
  | 'node_switch'
  | 'edit_operation'
  | 'practice_interaction'

export const TIMER_AUTOMATION_STORAGE_KEY = 'memory-anki-timer-automation-config'
export const TIMER_AUTOMATION_UPDATED_EVENT = APP_EVENT_NAMES.timerAutomationUpdated
export const TIMER_AUTOMATION_CONFIG_VERSION = 3

const LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG = {
  mode: 'scene' as const,
  actions: {
    autoResumeOnWindowReturn: false,
    countNodeSwitchAsActivity: false,
    countEditOperationsAsActivity: true,
    countPracticeInteractionsAsActivity: true,
  },
  shared: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  palace_edit: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 20,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 20,
  },
  practice: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  quiz: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  review: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  freestyle: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  english: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  english_reading: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 180,
    hiddenAutoPauseSeconds: 20,
    autoPauseRollbackSeconds: 90,
  },
} satisfies Omit<TimerAutomationConfig, 'schemaVersion'>

export const DEFAULT_TIMER_AUTOMATION_CONFIG: TimerAutomationConfig = {
  schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
  mode: 'global',
  actions: {
    autoResumeOnWindowReturn: false,
    countNodeSwitchAsActivity: false,
    countEditOperationsAsActivity: true,
    countPracticeInteractionsAsActivity: true,
  },
  shared: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  palace_edit: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  practice: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  quiz: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  review: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  freestyle: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  english: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
  english_reading: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  },
}

function sanitizeNonNegativeNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round(parsed)
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  return fallback
}

function sanitizeRule(
  value: unknown,
  fallback: TimerAutomationRule,
  legacyFallback: TimerAutomationRule,
  isLegacyConfig: boolean,
  legacyAutoStartOnPageEnter?: boolean,
): TimerAutomationRule {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const inactiveAutoPauseSeconds = sanitizeNonNegativeNumber(
    migrateLegacyField(
      raw.inactiveAutoPauseSeconds,
      legacyFallback.inactiveAutoPauseSeconds,
      fallback.inactiveAutoPauseSeconds,
      isLegacyConfig,
    ),
    fallback.inactiveAutoPauseSeconds,
  )
  const inactivePauseGraceSeconds = sanitizeNonNegativeNumber(
    raw.inactivePauseGraceSeconds,
    fallback.inactivePauseGraceSeconds ?? 30,
  )
  const hiddenAutoPauseSeconds = sanitizeNonNegativeNumber(
    migrateLegacyField(
      raw.hiddenAutoPauseSeconds,
      legacyFallback.hiddenAutoPauseSeconds,
      fallback.hiddenAutoPauseSeconds,
      isLegacyConfig,
    ),
    fallback.hiddenAutoPauseSeconds,
  )
  const autoPauseRollbackSeconds = Math.min(
    sanitizeNonNegativeNumber(
      migrateLegacyField(
        raw.autoPauseRollbackSeconds,
        legacyFallback.autoPauseRollbackSeconds,
        fallback.autoPauseRollbackSeconds,
        isLegacyConfig,
      ),
      fallback.autoPauseRollbackSeconds,
    ),
    inactiveAutoPauseSeconds,
  )
  const requestedAutoStart =
    raw.autoStartOnPageEnter === undefined
      ? legacyAutoStartOnPageEnter
      : migrateLegacyField(
          raw.autoStartOnPageEnter,
          legacyFallback.autoStartOnPageEnter,
          fallback.autoStartOnPageEnter,
          isLegacyConfig,
        )
  return {
    autoStartOnPageEnter: sanitizeBoolean(
      requestedAutoStart,
      fallback.autoStartOnPageEnter,
    ),
    inactiveAutoPauseSeconds,
    inactivePauseGraceSeconds,
    hiddenAutoPauseSeconds,
    autoPauseRollbackSeconds,
  }
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

export function sanitizeTimerAutomationConfig(value: unknown): TimerAutomationConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const parsedSchemaVersion = Number(raw.schemaVersion)
  const schemaVersion = Number.isFinite(parsedSchemaVersion) ? Math.round(parsedSchemaVersion) : 1
  const isLegacyConfig = schemaVersion < TIMER_AUTOMATION_CONFIG_VERSION
  const rawActions = raw.actions && typeof raw.actions === 'object' ? (raw.actions as Record<string, unknown>) : {}
  const legacyAutoStartOnPageEnter =
    typeof rawActions.autoStartOnPageEnter === 'boolean' ? rawActions.autoStartOnPageEnter : undefined
  const migrated = sanitizeRule(
    raw.shared,
    DEFAULT_TIMER_AUTOMATION_CONFIG.shared,
    LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.shared,
    isLegacyConfig,
    legacyAutoStartOnPageEnter,
  )
  const shared: TimerAutomationRule = {
    autoStartOnPageEnter: migrated.autoStartOnPageEnter,
    inactiveAutoPauseSeconds: migrated.inactiveAutoPauseSeconds,
    inactivePauseGraceSeconds: 0,
    hiddenAutoPauseSeconds: 0,
    autoPauseRollbackSeconds: 0,
  }
  return {
    schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
    mode: 'global',
    actions: {
      autoResumeOnWindowReturn: false,
      countNodeSwitchAsActivity: false,
      countEditOperationsAsActivity: true,
      countPracticeInteractionsAsActivity: true,
    },
    shared,
    palace_edit: { ...shared },
    practice: { ...shared },
    quiz: { ...shared },
    review: { ...shared },
    freestyle: { ...shared },
    english: { ...shared },
    english_reading: { ...shared },
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

export function getTimerAutomationRule(
  scene: TimerAutomationScene,
  config: TimerAutomationConfig,
) {
  if (config.mode === 'global') {
    return config.shared ?? DEFAULT_TIMER_AUTOMATION_CONFIG.shared
  }
  return config[scene] ?? DEFAULT_TIMER_AUTOMATION_CONFIG[scene]
}

export function getTimerAutomationActivityConfig(config: TimerAutomationConfig) {
  return config.actions ?? DEFAULT_TIMER_AUTOMATION_CONFIG.actions
}

export function isActivityEnabled(
  kind: TimerAutomationActivityKind,
  config: TimerAutomationConfig,
) {
  const actions = getTimerAutomationActivityConfig(config)
  switch (kind) {
    case 'window_return':
      return actions.autoResumeOnWindowReturn
    case 'node_switch':
      return actions.countNodeSwitchAsActivity
    case 'edit_operation':
      return actions.countEditOperationsAsActivity
    case 'practice_interaction':
      return actions.countPracticeInteractionsAsActivity
    default:
      return false
  }
}

export function shouldAutoStartOnPageEnter(
  config: TimerAutomationConfig,
  scene: TimerAutomationScene,
) {
  return getTimerAutomationRule(scene, config).autoStartOnPageEnter
}

export const TIMER_AUTOMATION_SCENE_LABELS: Record<TimerAutomationScene, string> = {
  palace_edit: '宫殿编辑',
  practice: '练习',
  quiz: '做题',
  review: '复习',
  freestyle: '随心模式',
  english: '英语听力',
  english_reading: '英语阅读',
}
