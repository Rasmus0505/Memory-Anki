import type { SessionKind } from '@/entities/session/model'

export type TimerAutomationScene = SessionKind | 'english'

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
  actions: TimerAutomationActivityConfig
  palace_edit: TimerAutomationRule
  practice: TimerAutomationRule
  review: TimerAutomationRule
  english: TimerAutomationRule
}

export type TimerAutomationActivityKind =
  | 'window_return'
  | 'node_switch'
  | 'edit_operation'
  | 'practice_interaction'

export const TIMER_AUTOMATION_STORAGE_KEY = 'memory-anki-timer-automation-config'

export const DEFAULT_TIMER_AUTOMATION_CONFIG: TimerAutomationConfig = {
  actions: {
    autoResumeOnWindowReturn: false,
    countNodeSwitchAsActivity: false,
    countEditOperationsAsActivity: true,
    countPracticeInteractionsAsActivity: true,
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
    actions: sanitizeActivityConfig(raw.actions, DEFAULT_TIMER_AUTOMATION_CONFIG.actions),
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
  }
}

export function readTimerAutomationConfig(): TimerAutomationConfig {
  try {
    const raw = window.localStorage.getItem(TIMER_AUTOMATION_STORAGE_KEY)
    if (!raw) return DEFAULT_TIMER_AUTOMATION_CONFIG
    return sanitizeTimerAutomationConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_TIMER_AUTOMATION_CONFIG
  }
}

export function saveTimerAutomationConfig(config: TimerAutomationConfig) {
  const sanitized = sanitizeTimerAutomationConfig(config)
  window.localStorage.setItem(TIMER_AUTOMATION_STORAGE_KEY, JSON.stringify(sanitized))
  window.dispatchEvent(new CustomEvent('memory-anki-timer-automation-change', { detail: sanitized }))
  return sanitized
}

export function resetTimerAutomationConfig() {
  window.localStorage.removeItem(TIMER_AUTOMATION_STORAGE_KEY)
  const nextConfig = DEFAULT_TIMER_AUTOMATION_CONFIG
  window.dispatchEvent(new CustomEvent('memory-anki-timer-automation-change', { detail: nextConfig }))
  return nextConfig
}

export function getTimerAutomationRule(
  scene: TimerAutomationScene,
  config: TimerAutomationConfig,
) {
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
  english: '英语区',
}
