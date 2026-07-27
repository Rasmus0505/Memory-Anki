import type { TimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import {
  sanitizeTimerAutomationConfig,
  TIMER_AUTOMATION_CONFIG_VERSION,
} from '@/shared/components/session/timer-automation-config'
import type { TimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import {
  sanitizeTimerFocusConfig,
  TIMER_FOCUS_CONFIG_VERSION,
} from '@/shared/components/session/timer-focus-config'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import {
  BREAK_GUARD_CONFIG_VERSION,
  sanitizeBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'

export type FieldKey =
  | 'idleTimeoutSeconds'
  | 'idleGraceSeconds'
  | 'backgroundGraceSeconds'
export type FocusFieldKey = 'primaryMinutes' | 'secondaryMinutes'
export type BreakNumberFieldKey = 'promptDelaySeconds'
export type BreakTextFieldKey = 'targetPath' | 'presetMinutes' | 'snoozeMinutes'
export type BreakBooleanFieldKey =
  | 'enabled'
  | 'promptOnWindowLeave'
  | 'allowCustomMinutes'
  | 'autoFinishOnStudyReturn'
  | 'resumeInterruptedStudyOnReturn'
  | 'recordBreakLogs'

export function parseMinuteList(value: string) {
  return value
    .split(',')
    .map((item) => Math.round(Number(item.trim())))
    .filter((item) => Number.isFinite(item) && item > 0)
}


export function toDraft(config: TimerAutomationConfig) {
  return {
    autoStartOnPageEnter: config.autoStartOnPageEnter,
    keepScreenAwake: config.keepScreenAwake,
    idleTimeoutSeconds: String(config.idleTimeoutSeconds),
    idleGraceSeconds: String(config.idleGraceSeconds),
    backgroundGraceSeconds: String(config.backgroundGraceSeconds),
  }
}

export function toFocusDraft(config: TimerFocusConfig) {
  return {
    primaryMinutes: String(config.primaryMinutes),
    secondaryMinutes: String(config.secondaryMinutes),
  }
}

export function toBreakDraft(config: BreakGuardConfig) {
  return {
    enabled: config.enabled,
    notifyOnBreakExpired: config.notifyOnBreakExpired,
    promptOnWindowLeave: config.promptOnWindowLeave,
    promptDelaySeconds: String(config.promptDelaySeconds),
    presetMinutes: config.presetMinutes.join(', '),
    allowCustomMinutes: config.allowCustomMinutes,
    autoFinishOnStudyReturn: config.autoFinishOnStudyReturn,
    resumeInterruptedStudyOnReturn: config.resumeInterruptedStudyOnReturn,
    targetPath: config.targetPath,
    alertStrength: config.alertStrength,
    snoozeMinutes: config.snoozeMinutes.join(', '),
    recordBreakLogs: config.recordBreakLogs,
  }
}

export type AutomationDraft = ReturnType<typeof toDraft>
export type FocusDraft = ReturnType<typeof toFocusDraft>
export type BreakDraft = ReturnType<typeof toBreakDraft>

export function parseAutomationDraft(draft: AutomationDraft): TimerAutomationConfig {
  return sanitizeTimerAutomationConfig({
    schemaVersion: TIMER_AUTOMATION_CONFIG_VERSION,
    autoStartOnPageEnter: draft.autoStartOnPageEnter,
    keepScreenAwake: draft.keepScreenAwake,
    idleTimeoutSeconds: draft.idleTimeoutSeconds,
    idleGraceSeconds: draft.idleGraceSeconds,
    backgroundGraceSeconds: draft.backgroundGraceSeconds,
  })
}

export function parseFocusDraft(draft: FocusDraft): TimerFocusConfig {
  return sanitizeTimerFocusConfig({
    schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
    primaryMinutes: draft.primaryMinutes,
    secondaryMinutes: draft.secondaryMinutes,
  })
}

export function parseBreakDraft(draft: BreakDraft): BreakGuardConfig {
  return sanitizeBreakGuardConfig({
    schemaVersion: BREAK_GUARD_CONFIG_VERSION,
    enabled: draft.enabled,
    notifyOnBreakExpired: draft.notifyOnBreakExpired,
    promptOnWindowLeave: draft.promptOnWindowLeave,
    promptDelaySeconds: draft.promptDelaySeconds,
    presetMinutes: parseMinuteList(draft.presetMinutes),
    allowCustomMinutes: draft.allowCustomMinutes,
    autoFinishOnStudyReturn: draft.autoFinishOnStudyReturn,
    resumeInterruptedStudyOnReturn: draft.resumeInterruptedStudyOnReturn,
    targetPath: draft.targetPath,
    alertStrength: draft.alertStrength,
    snoozeMinutes: parseMinuteList(draft.snoozeMinutes),
    recordBreakLogs: draft.recordBreakLogs,
  })
}
