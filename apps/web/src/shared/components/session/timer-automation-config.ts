import type { SessionKind } from '@/entities/session/model'

export type TimerAutomationScene = SessionKind

export interface TimerAutomationRule {
  inactiveAutoPauseSeconds: number
  hiddenAutoPauseSeconds: number
  autoPauseRollbackSeconds: number
}

export type TimerAutomationConfig = Record<TimerAutomationScene, TimerAutomationRule>

export const TIMER_AUTOMATION_STORAGE_KEY = 'memory-anki-timer-automation-config'

export const DEFAULT_TIMER_AUTOMATION_CONFIG: TimerAutomationConfig = {
  palace_edit: {
    inactiveAutoPauseSeconds: 20,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  practice: {
    inactiveAutoPauseSeconds: 120,
    hiddenAutoPauseSeconds: 15,
    autoPauseRollbackSeconds: 60,
  },
  review: {
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

function sanitizeRule(value: unknown, fallback: TimerAutomationRule): TimerAutomationRule {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    inactiveAutoPauseSeconds: sanitizeNonNegativeNumber(
      raw.inactiveAutoPauseSeconds,
      fallback.inactiveAutoPauseSeconds,
    ),
    hiddenAutoPauseSeconds: sanitizeNonNegativeNumber(
      raw.hiddenAutoPauseSeconds,
      fallback.hiddenAutoPauseSeconds,
    ),
    autoPauseRollbackSeconds: sanitizeNonNegativeNumber(
      raw.autoPauseRollbackSeconds,
      fallback.autoPauseRollbackSeconds,
    ),
  }
}

export function sanitizeTimerAutomationConfig(value: unknown): TimerAutomationConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    palace_edit: sanitizeRule(raw.palace_edit, DEFAULT_TIMER_AUTOMATION_CONFIG.palace_edit),
    practice: sanitizeRule(raw.practice, DEFAULT_TIMER_AUTOMATION_CONFIG.practice),
    review: sanitizeRule(raw.review, DEFAULT_TIMER_AUTOMATION_CONFIG.review),
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

export const TIMER_AUTOMATION_SCENE_LABELS: Record<TimerAutomationScene, string> = {
  palace_edit: '宫殿编辑',
  practice: '练习',
  review: '复习',
}
