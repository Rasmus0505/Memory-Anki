import type {
  TimerAutomationActivityConfig,
  TimerAutomationConfig,
  TimerAutomationRule,
} from '@/shared/components/session/timer-automation-config'
import {
  sanitizeTimerAutomationConfig,
  TIMER_AUTOMATION_CONFIG_VERSION,
} from '@/shared/components/session/timer-automation-config'
import type {
  TimerCelebrationVisualPreset,
  TimerFocusConfig,
  TimerFocusRule,
} from '@/shared/components/session/timer-focus-config'
import {
  sanitizeTimerFocusConfig,
  TIMER_FOCUS_CONFIG_VERSION,
} from '@/shared/components/session/timer-focus-config'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import {
  BREAK_GUARD_CONFIG_VERSION,
  sanitizeBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'

export type FieldKey = keyof TimerAutomationRule
export type ActionFieldKey = keyof TimerAutomationActivityConfig
export type FocusFieldKey = keyof TimerFocusRule
export type CelebrationEventKey = 'secondaryInterval' | 'primaryGoal'
export type CelebrationBooleanFieldKey = 'enabled' | 'soundEnabled' | 'animationEnabled'
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

export const TIMER_VISUAL_PRESET_LABELS: Record<TimerCelebrationVisualPreset, string> = {
  auto: '自动',
  random_direction: '随机方向',
  realistic_look: '真实烟花',
  fireworks: '礼花',
  stars: '星星',
  school_pride: '冲顶',
}

export function toDraft(config: TimerAutomationConfig) {
  return {
    mode: config.mode,
    actions: {
      autoResumeOnWindowReturn: config.actions.autoResumeOnWindowReturn,
      countNodeSwitchAsActivity: config.actions.countNodeSwitchAsActivity,
      countEditOperationsAsActivity: config.actions.countEditOperationsAsActivity,
      countPracticeInteractionsAsActivity: config.actions.countPracticeInteractionsAsActivity,
    },
    shared: {
      autoStartOnPageEnter: config.shared.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.shared.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.shared.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.shared.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.shared.autoPauseRollbackSeconds),
    },
    palace_edit: {
      autoStartOnPageEnter: config.palace_edit.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.palace_edit.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.palace_edit.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.palace_edit.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.palace_edit.autoPauseRollbackSeconds),
    },
    practice: {
      autoStartOnPageEnter: config.practice.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.practice.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.practice.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.practice.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.practice.autoPauseRollbackSeconds),
    },
    quiz: {
      autoStartOnPageEnter: config.quiz.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.quiz.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.quiz.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.quiz.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.quiz.autoPauseRollbackSeconds),
    },
    review: {
      autoStartOnPageEnter: config.review.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.review.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.review.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.review.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.review.autoPauseRollbackSeconds),
    },
    freestyle: {
      autoStartOnPageEnter: config.freestyle.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.freestyle.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.freestyle.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.freestyle.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.freestyle.autoPauseRollbackSeconds),
    },
    english: {
      autoStartOnPageEnter: config.english.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.english.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.english.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.english.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.english.autoPauseRollbackSeconds),
    },
    english_reading: {
      autoStartOnPageEnter: config.english_reading.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.english_reading.inactiveAutoPauseSeconds),
      inactivePauseGraceSeconds: String(config.english_reading.inactivePauseGraceSeconds ?? 30),
      hiddenAutoPauseSeconds: String(config.english_reading.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.english_reading.autoPauseRollbackSeconds),
    },
  }
}

export function toFocusDraft(config: TimerFocusConfig) {
  return {
    mode: config.mode,
    feedbackIntensity: config.feedbackIntensity,
    celebration: {
      secondaryInterval: {
        ...config.celebration.secondaryInterval,
        volumeBoost: String(config.celebration.secondaryInterval.volumeBoost),
      },
      primaryGoal: {
        ...config.celebration.primaryGoal,
        volumeBoost: String(config.celebration.primaryGoal.volumeBoost),
      },
    },
    global: {
      primaryMinutes: String(config.global.primaryMinutes),
      secondaryMinutes: String(config.global.secondaryMinutes),
      breakMinutes: String(config.global.breakMinutes ?? 5),
    },
    palace_edit: {
      primaryMinutes: String(config.palace_edit.primaryMinutes),
      secondaryMinutes: String(config.palace_edit.secondaryMinutes),
      breakMinutes: String(config.palace_edit.breakMinutes ?? 5),
    },
    practice: {
      primaryMinutes: String(config.practice.primaryMinutes),
      secondaryMinutes: String(config.practice.secondaryMinutes),
      breakMinutes: String(config.practice.breakMinutes ?? 5),
    },
    quiz: {
      primaryMinutes: String(config.quiz.primaryMinutes),
      secondaryMinutes: String(config.quiz.secondaryMinutes),
      breakMinutes: String(config.quiz.breakMinutes ?? 5),
    },
    review: {
      primaryMinutes: String(config.review.primaryMinutes),
      secondaryMinutes: String(config.review.secondaryMinutes),
      breakMinutes: String(config.review.breakMinutes ?? 5),
    },
    freestyle: {
      primaryMinutes: String(config.freestyle.primaryMinutes),
      secondaryMinutes: String(config.freestyle.secondaryMinutes),
      breakMinutes: String(config.freestyle.breakMinutes ?? 5),
    },
    english: {
      primaryMinutes: String(config.english.primaryMinutes),
      secondaryMinutes: String(config.english.secondaryMinutes),
      breakMinutes: String(config.english.breakMinutes ?? 5),
    },
    english_reading: {
      primaryMinutes: String(config.english_reading.primaryMinutes),
      secondaryMinutes: String(config.english_reading.secondaryMinutes),
      breakMinutes: String(config.english_reading.breakMinutes ?? 5),
    },
  }
}

export function toBreakDraft(config: BreakGuardConfig) {
  return {
    enabled: config.enabled,
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
    mode: draft.mode,
    actions: {
      autoResumeOnWindowReturn: draft.actions.autoResumeOnWindowReturn,
      countNodeSwitchAsActivity: draft.actions.countNodeSwitchAsActivity,
      countEditOperationsAsActivity: draft.actions.countEditOperationsAsActivity,
      countPracticeInteractionsAsActivity: draft.actions.countPracticeInteractionsAsActivity,
    },
    shared: {
      autoStartOnPageEnter: draft.shared.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.shared.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.shared.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.shared.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.shared.autoPauseRollbackSeconds,
    },
    palace_edit: {
      autoStartOnPageEnter: draft.palace_edit.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.palace_edit.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.palace_edit.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.palace_edit.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.palace_edit.autoPauseRollbackSeconds,
    },
    practice: {
      autoStartOnPageEnter: draft.practice.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.practice.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.practice.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.practice.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.practice.autoPauseRollbackSeconds,
    },
    quiz: {
      autoStartOnPageEnter: draft.quiz.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.quiz.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.quiz.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.quiz.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.quiz.autoPauseRollbackSeconds,
    },
    review: {
      autoStartOnPageEnter: draft.review.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.review.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.review.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.review.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.review.autoPauseRollbackSeconds,
    },
    freestyle: {
      autoStartOnPageEnter: draft.freestyle.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.freestyle.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.freestyle.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.freestyle.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.freestyle.autoPauseRollbackSeconds,
    },
    english: {
      autoStartOnPageEnter: draft.english.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.english.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.english.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.english.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.english.autoPauseRollbackSeconds,
    },
    english_reading: {
      autoStartOnPageEnter: draft.english_reading.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: draft.english_reading.inactiveAutoPauseSeconds,
      inactivePauseGraceSeconds: draft.english_reading.inactivePauseGraceSeconds,
      hiddenAutoPauseSeconds: draft.english_reading.hiddenAutoPauseSeconds,
      autoPauseRollbackSeconds: draft.english_reading.autoPauseRollbackSeconds,
    },
  })
}

export function parseFocusDraft(draft: FocusDraft): TimerFocusConfig {
  return sanitizeTimerFocusConfig({
    schemaVersion: TIMER_FOCUS_CONFIG_VERSION,
    mode: draft.mode,
    feedbackIntensity: draft.feedbackIntensity,
    celebration: {
      secondaryInterval: {
        ...draft.celebration.secondaryInterval,
        volumeBoost: Number(draft.celebration.secondaryInterval.volumeBoost),
      },
      primaryGoal: {
        ...draft.celebration.primaryGoal,
        volumeBoost: Number(draft.celebration.primaryGoal.volumeBoost),
      },
    },
    global: {
      primaryMinutes: draft.global.primaryMinutes,
      secondaryMinutes: draft.global.secondaryMinutes,
      breakMinutes: draft.global.breakMinutes,
    },
    palace_edit: {
      primaryMinutes: draft.palace_edit.primaryMinutes,
      secondaryMinutes: draft.palace_edit.secondaryMinutes,
      breakMinutes: draft.palace_edit.breakMinutes,
    },
    practice: {
      primaryMinutes: draft.practice.primaryMinutes,
      secondaryMinutes: draft.practice.secondaryMinutes,
      breakMinutes: draft.practice.breakMinutes,
    },
    quiz: {
      primaryMinutes: draft.quiz.primaryMinutes,
      secondaryMinutes: draft.quiz.secondaryMinutes,
      breakMinutes: draft.quiz.breakMinutes,
    },
    review: {
      primaryMinutes: draft.review.primaryMinutes,
      secondaryMinutes: draft.review.secondaryMinutes,
      breakMinutes: draft.review.breakMinutes,
    },
    freestyle: {
      primaryMinutes: draft.freestyle.primaryMinutes,
      secondaryMinutes: draft.freestyle.secondaryMinutes,
      breakMinutes: draft.freestyle.breakMinutes,
    },
    english: {
      primaryMinutes: draft.english.primaryMinutes,
      secondaryMinutes: draft.english.secondaryMinutes,
      breakMinutes: draft.english.breakMinutes,
    },
    english_reading: {
      primaryMinutes: draft.english_reading.primaryMinutes,
      secondaryMinutes: draft.english_reading.secondaryMinutes,
      breakMinutes: draft.english_reading.breakMinutes,
    },
  })
}

export function parseBreakDraft(draft: BreakDraft): BreakGuardConfig {
  return sanitizeBreakGuardConfig({
    schemaVersion: BREAK_GUARD_CONFIG_VERSION,
    enabled: draft.enabled,
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
