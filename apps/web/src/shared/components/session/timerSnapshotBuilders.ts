import {
  getTimerAutomationRule,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  getTimerFocusRule,
  TIMER_FOCUS_SCENE_LABELS,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import type { BreakGuardState } from '@/shared/components/session/breakGuardModel'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import {
  formatClock,
  formatIdlePrimaryProgress,
  formatPrimaryProgress,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'

export function createBreakLogId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `break-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatTimerSnapshotClock(seconds: number | null) {
  if (seconds == null) return '--:--'
  return formatClock(seconds)
}

export function buildStudyTimerSnapshot({
  activeEntry,
  focusConfig,
  automationConfig,
}: {
  activeEntry: GlobalTimerRegistration | null
  focusConfig: TimerFocusConfig
  automationConfig: TimerAutomationConfig
}): UnifiedTimerSnapshot {
  const scene = activeEntry?.scene ?? null
  const sceneLabel = scene ? TIMER_FOCUS_SCENE_LABELS[scene] : '计时器'
  const focusRule = scene ? getTimerFocusRule(scene, focusConfig) : focusConfig.global
  const automationRule = scene ? getTimerAutomationRule(scene, automationConfig) : null
  const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
  const secondarySeconds = Math.max(60, Math.min(primarySeconds, focusRule.secondaryMinutes * 60))
  const effectiveSeconds = activeEntry?.timer.effectiveSeconds ?? 0
  const secondaryRemainder = secondarySeconds > 0 ? effectiveSeconds % secondarySeconds : 0
  const secondaryRemaining =
    secondarySeconds > 0
      ? secondaryRemainder === 0
        ? secondarySeconds
        : secondarySeconds - secondaryRemainder
      : 0
  const idleText = automationRule
    ? `闲置 ${activeEntry?.timer.idleSeconds ?? 0}/${automationRule.inactiveAutoPauseSeconds} 秒`
    : '当前无学习会话'
  const status = activeEntry?.timer.status ?? 'idle'

  return {
    mode: 'study',
    status,
    title: activeEntry?.title ?? '待开始',
    scene: sceneLabel,
    displaySeconds: activeEntry ? secondaryRemaining : secondarySeconds,
    primaryText: activeEntry ? idleText : '当前无学习会话',
    secondaryText: activeEntry
      ? formatPrimaryProgress(effectiveSeconds, primarySeconds)
      : formatIdlePrimaryProgress(primarySeconds),
    snoozeCount: 0,
    availableActions: activeEntry
      ? status === 'running'
        ? ['pause']
        : ['resume']
      : [],
    presetMinutes: [],
    snoozeMinutes: [],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
  }
}

export function buildBreakTimerSnapshot({
  breakState,
  config,
  paused,
  pausedRemainingMs,
  now = Date.now(),
}: {
  breakState: BreakGuardState
  config: BreakGuardConfig
  paused: boolean
  pausedRemainingMs?: number | null
  now?: number
}): UnifiedTimerSnapshot {
  const remainingMs =
    paused && pausedRemainingMs != null
      ? pausedRemainingMs
      : breakState.status === 'counting_down' && breakState.expiresAt != null
        ? Math.max(0, breakState.expiresAt - now)
        : breakState.status === 'expired'
        ? 0
        : null
  const displaySeconds = remainingMs == null ? null : Math.ceil(remainingMs / 1000)
  const plannedText = breakState.plannedMinutes ? `计划 ${breakState.plannedMinutes} 分钟` : '选择这次休息多久'
  const snoozeText = `延后 ${breakState.snoozeCount} 次`

  if (breakState.status === 'prompting') {
    return {
      mode: 'break',
      status: 'prompting',
      title: '要开始休息吗？',
      scene: '休息询问',
      displaySeconds: null,
      primaryText: '离开学习页一会儿了',
      secondaryText: '开始休息会暂停当前学习计时',
      snoozeCount: breakState.snoozeCount,
      availableActions: ['startBreak'],
      presetMinutes: config.presetMinutes,
      allowCustomMinutes: config.allowCustomMinutes,
      snoozeMinutes: config.snoozeMinutes,
      targetPath: config.targetPath,
      updatedAt: now,
    }
  }

  if (breakState.status === 'expired') {
    return {
      mode: 'break',
      status: 'expired',
      title: '该回来了',
      scene: '休息到点',
      displaySeconds: 0,
      primaryText: '休息已经结束',
      secondaryText: `${plannedText} · ${snoozeText}`,
      snoozeCount: breakState.snoozeCount,
      availableActions: ['snooze', 'finishBreak', 'openTarget'],
      presetMinutes: config.presetMinutes,
      allowCustomMinutes: config.allowCustomMinutes,
      snoozeMinutes: config.snoozeMinutes,
      targetPath: config.targetPath,
      updatedAt: now,
    }
  }

  return {
    mode: 'break',
    status: paused ? 'paused' : 'running',
    title: paused ? '休息已暂停' : '休息倒计时',
    scene: '休息中',
    displaySeconds,
    primaryText: plannedText,
    secondaryText: snoozeText,
    snoozeCount: breakState.snoozeCount,
    availableActions: [paused ? 'resume' : 'pause', 'finishBreak', 'openTarget'],
    presetMinutes: config.presetMinutes,
    allowCustomMinutes: config.allowCustomMinutes,
    snoozeMinutes: config.snoozeMinutes,
    targetPath: config.targetPath,
    updatedAt: now,
  }
}
