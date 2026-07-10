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
import type {
  UnifiedTimerFeedbackSignal,
  UnifiedTimerSnapshot,
  UnifiedTimerStudyPhase,
} from '@/shared/components/session/desktopTimerBridge'
import {
  formatClock,
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
  feedbackSignal = null,
}: {
  activeEntry: GlobalTimerRegistration | null
  focusConfig: TimerFocusConfig
  automationConfig: TimerAutomationConfig
  feedbackSignal?: UnifiedTimerFeedbackSignal | null
}): UnifiedTimerSnapshot {
  const scene = activeEntry?.scene ?? null
  const sceneLabel = scene ? TIMER_FOCUS_SCENE_LABELS[scene] : '计时器'
  const focusRule = scene ? getTimerFocusRule(scene, focusConfig) : focusConfig.global
  const automationRule = scene ? getTimerAutomationRule(scene, automationConfig) : null
  const primarySeconds = Math.max(60, focusRule.primaryMinutes * 60)
  const effectiveSeconds = activeEntry?.timer.effectiveSeconds ?? 0
  const roundState = activeEntry?.timer.focusRound
  const roundStartedAt = Math.min(
    effectiveSeconds,
    Math.max(0, roundState?.startedAtEffectiveSeconds ?? 0),
  )
  const roundElapsedSeconds = Math.max(0, effectiveSeconds - roundStartedAt)
  const roundIndex = Math.max(1, roundState?.roundIndex ?? 1)
  const status = activeEntry?.timer.status ?? 'idle'
  const goalReached = Boolean(activeEntry && roundElapsedSeconds >= primarySeconds)
  const idleSeconds = activeEntry?.timer.idleSeconds ?? 0
  const warningThreshold = Math.max(0, automationRule?.inactiveAutoPauseSeconds ?? 0)
  const warningGrace = Math.max(0, automationRule?.inactivePauseGraceSeconds ?? 30)
  const idleWarningRemainingSeconds =
    activeEntry && status === 'running' && warningGrace > 0 && idleSeconds >= warningThreshold
      ? Math.max(0, warningThreshold + warningGrace - idleSeconds)
      : null
  const studyPhase: UnifiedTimerStudyPhase = !activeEntry
    ? 'idle'
    : status === 'paused'
      ? 'paused'
      : status === 'completed'
        ? 'completed'
        : goalReached
          ? 'goal_reached'
          : idleWarningRemainingSeconds != null
            ? 'idle_warning'
            : 'focusing'
  const primaryText =
    studyPhase === 'goal_reached'
      ? `第 ${roundIndex} 轮已达标，继续学习或休息一下`
      : studyPhase === 'idle_warning'
        ? `仍在学习吗？${idleWarningRemainingSeconds} 秒后自动暂停`
        : studyPhase === 'paused'
          ? '计时已暂停，本轮进度已保留'
          : studyPhase === 'completed'
            ? '本次学习已经完成'
            : activeEntry && automationRule
              ? `专注中 · 闲置 ${idleSeconds}/${warningThreshold} 秒`
              : '当前无学习会话'
  const secondaryText = activeEntry
    ? `本轮 ${formatClock(Math.min(roundElapsedSeconds, primarySeconds))}/${formatClock(primarySeconds)} · 第 ${roundIndex} 轮`
    : `本轮 ${formatClock(0)}/${formatClock(primarySeconds)}`
  const suggestedBreakMinutes = Math.max(1, Math.round(focusRule.breakMinutes ?? 5))

  return {
    mode: 'study',
    status,
    title: activeEntry?.title ?? '待开始',
    scene: sceneLabel,
    displaySeconds: effectiveSeconds,
    primaryText,
    secondaryText,
    snoozeCount: 0,
    availableActions: activeEntry
      ? studyPhase === 'goal_reached'
        ? ['continueRound', 'startGoalBreak']
        : status === 'running'
          ? ['pause']
          : status === 'paused' || status === 'idle'
            ? ['resume']
            : []
      : [],
    presetMinutes: [],
    snoozeMinutes: [],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
    studyPhase,
    effectiveSeconds,
    roundElapsedSeconds,
    roundTargetSeconds: primarySeconds,
    roundIndex,
    idleWarningRemainingSeconds,
    suggestedBreakMinutes,
    feedbackSignal,
  }
}

export function buildBreakTimerSnapshot({
  breakState,
  config,
  paused,
  pausedRemainingMs,
  targetPath,
  now = Date.now(),
}: {
  breakState: BreakGuardState
  config: BreakGuardConfig
  paused: boolean
  pausedRemainingMs?: number | null
  targetPath?: string | null
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
  const resolvedTargetPath = targetPath ?? config.targetPath

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
      targetPath: resolvedTargetPath,
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
      primaryText: '休息已经结束，准备好后手动开始学习',
      secondaryText: `${plannedText} · ${snoozeText}`,
      snoozeCount: breakState.snoozeCount,
      availableActions: ['snooze', 'startStudy'],
      presetMinutes: config.presetMinutes,
      allowCustomMinutes: config.allowCustomMinutes,
      snoozeMinutes: config.snoozeMinutes,
      targetPath: resolvedTargetPath,
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
    availableActions: [paused ? 'resume' : 'pause', 'startStudy'],
    presetMinutes: config.presetMinutes,
    allowCustomMinutes: config.allowCustomMinutes,
    snoozeMinutes: config.snoozeMinutes,
    targetPath: resolvedTargetPath,
    updatedAt: now,
  }
}
