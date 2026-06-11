import type { SessionKind } from '@/entities/session/model'

import {
  getCachedClientPreference,
  setClientPreference,
} from '@/shared/preferences/clientPreferences'

export type TimerAutomationScene = SessionKind | 'english' | 'english_reading'
export type TimerAutomationMode = 'scene' | 'global'

export interface TimerAutomationRule {
  autoStartOnPageEnter: boolean
  inactiveAutoPauseSeconds: number
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
  mode: TimerAutomationMode
  actions: TimerAutomationActivityConfig
  shared: TimerAutomationRule
  palace_edit: TimerAutomationRule
  practice: TimerAutomationRule
  review: TimerAutomationRule
  english: TimerAutomationRule
  english_reading: TimerAutomationRule
}

export type TimerAutomationActivityKind =
  | 'window_return'
  | 'node_switch'
  | 'edit_operation'
  | 'practice_interaction'

export const TIMER_AUTOMATION_STORAGE_KEY = 'memory-anki-timer-automation-config'

export const DEFAULT_TIMER_AUTOMATION_CONFIG: TimerAutomationConfig = {
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
  review: {
    autoStartOnPageEnter: false,
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
  legacyAutoStartOnPageEnter?: boolean,
): TimerAutomationRule {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const inactiveAutoPauseSeconds = sanitizeNonNegativeNumber(
    raw.inactiveAutoPauseSeconds,
    fallback.inactiveAutoPauseSeconds,
  )
  const hiddenAutoPauseSeconds = sanitizeNonNegativeNumber(
    raw.hiddenAutoPauseSeconds,
    fallback.hiddenAutoPauseSeconds,
  )
  const autoPauseRollbackSeconds = Math.min(
    sanitizeNonNegativeNumber(raw.autoPauseRollbackSeconds, fallback.autoPauseRollbackSeconds),
    inactiveAutoPauseSeconds,
  )
  return {
    autoStartOnPageEnter: sanitizeBoolean(
      raw.autoStartOnPageEnter,
      legacyAutoStartOnPageEnter ?? fallback.autoStartOnPageEnter,
    ),
    inactiveAutoPauseSeconds,
    hiddenAutoPauseSeconds,
    autoPauseRollbackSeconds,
  }
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
  const rawActions = raw.actions && typeof raw.actions === 'object' ? (raw.actions as Record<string, unknown>) : {}
  const legacyAutoStartOnPageEnter =
    typeof rawActions.autoStartOnPageEnter === 'boolean' ? rawActions.autoStartOnPageEnter : undefined
  const practice = sanitizeRule(
    raw.practice,
    DEFAULT_TIMER_AUTOMATION_CONFIG.practice,
    legacyAutoStartOnPageEnter,
  )
  return {
    mode: raw.mode === 'global' ? 'global' : DEFAULT_TIMER_AUTOMATION_CONFIG.mode,
    actions: sanitizeActivityConfig(raw.actions, DEFAULT_TIMER_AUTOMATION_CONFIG.actions),
    shared: sanitizeRule(raw.shared, DEFAULT_TIMER_AUTOMATION_CONFIG.shared, legacyAutoStartOnPageEnter),
    palace_edit: sanitizeRule(
      raw.palace_edit,
      DEFAULT_TIMER_AUTOMATION_CONFIG.palace_edit,
      legacyAutoStartOnPageEnter,
    ),
    practice,
    review: sanitizeRule(raw.review, DEFAULT_TIMER_AUTOMATION_CONFIG.review, legacyAutoStartOnPageEnter),
    english:
      raw.english === undefined
        ? {
            ...practice,
          }
        : sanitizeRule(raw.english, DEFAULT_TIMER_AUTOMATION_CONFIG.english, legacyAutoStartOnPageEnter),
    english_reading:
      raw.english_reading === undefined
        ? raw.english === undefined
          ? {
              ...DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
            }
          : sanitizeRule(raw.english, DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading, legacyAutoStartOnPageEnter)
        : sanitizeRule(
            raw.english_reading,
            DEFAULT_TIMER_AUTOMATION_CONFIG.english_reading,
            legacyAutoStartOnPageEnter,
          ),
  }
}

export function readTimerAutomationConfig(): TimerAutomationConfig {
  try {
    const raw = window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)
    if (raw) {
      return sanitizeTimerAutomationConfig(JSON.parse(raw))
    }
  } catch {
    return DEFAULT_TIMER_AUTOMATION_CONFIG
  }

  const cached = getCachedClientPreference(
    'timer_automation_config',
    DEFAULT_TIMER_AUTOMATION_CONFIG,
    (value): value is TimerAutomationConfig => Boolean(value && typeof value === 'object'),
  )
  if (cached !== DEFAULT_TIMER_AUTOMATION_CONFIG) {
    return sanitizeTimerAutomationConfig(cached)
  }
  return DEFAULT_TIMER_AUTOMATION_CONFIG
}

export function saveTimerAutomationConfig(config: TimerAutomationConfig) {
  const sanitized = sanitizeTimerAutomationConfig(config)
  window.localStorage.setItem(TIMER_AUTOMATION_STORAGE_KEY, JSON.stringify(sanitized))
  void setClientPreference('timer_automation_config', sanitized).then((saved) => {
    window.dispatchEvent(new CustomEvent('memory-anki-timer-automation-change', { detail: saved }))
  })
  return sanitized
}

export function resetTimerAutomationConfig() {
  const nextConfig = DEFAULT_TIMER_AUTOMATION_CONFIG
  window.localStorage.removeItem(TIMER_AUTOMATION_STORAGE_KEY)
  void setClientPreference('timer_automation_config', nextConfig).then((saved) => {
    window.dispatchEvent(new CustomEvent('memory-anki-timer-automation-change', { detail: saved }))
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
  review: '复习',
  english: '英语听力',
  english_reading: '英语阅读',
}
