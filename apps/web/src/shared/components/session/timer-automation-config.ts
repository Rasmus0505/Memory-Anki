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
export const TIMER_AUTOMATION_CONFIG_VERSION = 2

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
  mode: 'scene',
  actions: {
    autoResumeOnWindowReturn: false,
    countNodeSwitchAsActivity: false,
    countEditOperationsAsActivity: true,
    countPracticeInteractionsAsActivity: true,
  },
  shared: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  palace_edit: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  practice: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  quiz: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  review: {
    autoStartOnPageEnter: false,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  freestyle: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  english: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 0,
  },
  english_reading: {
    autoStartOnPageEnter: true,
    inactiveAutoPauseSeconds: 120,
    inactivePauseGraceSeconds: 30,
    hiddenAutoPauseSeconds: 15,
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

function sanitizeActivityConfig(
  value: unknown,
  fallback: TimerAutomationActivityConfig,
): TimerAutomationActivityConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    autoResumeOnWindowReturn: sanitizeBoolean(raw.autoResumeOnWindowReturn, fallback.autoResumeOnWindowReturn),
    countNodeSwitchAsActivity: sanitizeBoolean(raw.countNodeSwitchAsActivity, fallback.countNodeSwitchAsActivity),
    countEditOperationsAsActivity: sanitizeBoolean(raw.countEditOperationsAsActivity, fallback.countEditOperationsAsActivity),
    countPracticeInteractionsAsActivity: sanitizeBoolean(
      raw.countPracticeInteractionsAsActivity,
      fallback.countPracticeInteractionsAsActivity,
    ),
  }
}

export function sanitizeTimerAutomationConfig(value: unknown): TimerAutomationConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const parsedSchemaVersion = Number(raw.schemaVersion)
  const schemaVersion = Number.isFinite(parsedSchemaVersion) ? Math.round(parsedSchemaVersion) : 1
  const isLegacyConfig = schemaVersion < TIMER_AUTOMATION_CONFIG_VERSION
  const rawActions = raw.actions && typeof raw.actions === 'object' ? (raw.actions as Record<string, unknown>) : {}
  const legacyAutoStartOnPageEnter =
    typeof rawActions.autoStartOnPageEnter === 'boolean' ? rawActions.autoStartOnPageEnter : undefined
  const practice = sanitizeRule(
    raw.practice,
    DEFAULT_TIMER_AUTOMATION_CONFIG.practice,
    LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.practice,
    isLegacyConfig,
    legacyAutoStartOnPageEnter,
  )
  const quiz =
    raw.quiz === undefined && isLegacyConfig
      ? {
          ...practice,
          autoStartOnPageEnter: DEFAULT_TIMER_AUTOMATION_CONFIG.quiz.autoStartOnPageEnter,
        }
      : sanitizeRule(
          raw.quiz,
          DEFAULT_TIMER_AUTOMATION_CONFIG.quiz,
          LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.quiz,
          isLegacyConfig,
          legacyAutoStartOnPageEnter,
        )
  return {
    schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
    mode: raw.mode === 'global' ? 'global' : DEFAULT_TIMER_AUTOMATION_CONFIG.mode,
    actions: sanitizeActivityConfig(raw.actions, DEFAULT_TIMER_AUTOMATION_CONFIG.actions),
    shared: sanitizeRule(
      raw.shared,
      DEFAULT_TIMER_AUTOMATION_CONFIG.shared,
      LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.shared,
      isLegacyConfig,
      legacyAutoStartOnPageEnter,
    ),
    palace_edit: sanitizeRule(
      raw.palace_edit,
      DEFAULT_TIMER_AUTOMATION_CONFIG.palace_edit,
      LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.palace_edit,
      isLegacyConfig,
      legacyAutoStartOnPageEnter,
    ),
    practice,
    quiz,
    review: sanitizeRule(
      raw.review,
      DEFAULT_TIMER_AUTOMATION_CONFIG.review,
      LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.review,
      isLegacyConfig,
      legacyAutoStartOnPageEnter,
    ),
    freestyle:
      raw.freestyle === undefined && isLegacyConfig
        ? {
            ...quiz,
          }
        : sanitizeRule(
            raw.freestyle,
            DEFAULT_TIMER_AUTOMATION_CONFIG.freestyle,
            LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.freestyle,
            isLegacyConfig,
            legacyAutoStartOnPageEnter,
          ),
    english:
      raw.english === undefined && isLegacyConfig
        ? {
            ...practice,
          }
        : sanitizeRule(
            raw.english,
            DEFAULT_TIMER_AUTOMATION_CONFIG.english,
            LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.english,
            isLegacyConfig,
            legacyAutoStartOnPageEnter,
          ),
    english_reading:
      raw.english_reading === undefined && isLegacyConfig
        ? raw.english === undefined
          ? {
              ...DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
            }
          : sanitizeRule(
              raw.english,
              DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
              LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
              isLegacyConfig,
              legacyAutoStartOnPageEnter,
            )
        : sanitizeRule(
            raw.english_reading,
            DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
            LEGACY_DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
            isLegacyConfig,
            legacyAutoStartOnPageEnter,
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
