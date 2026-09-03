import { TIMER_FOCUS_SCENE_LABELS } from '@/shared/components/session/timer-scenes'
import type {
  UnifiedTimerAction,
  UnifiedTimerSnapshot,
  UnifiedTimerStatus,
} from '@/shared/components/session/desktopTimerBridge'
import {
  formatClock,
  selectActiveTimerEntry,
  type GlobalTimerRegistration,
} from '@/shared/components/session/globalTimerModel'

/** Keep the bridge snapshot deliberately boring: one elapsed clock and three controls. */
export function buildStudyTimerSnapshot({
  activeEntry,
}: {
  activeEntry: GlobalTimerRegistration | null
  automationConfig?: unknown
  focusConfig?: unknown
  breakConfig?: unknown
}): UnifiedTimerSnapshot {
  const status: UnifiedTimerStatus = activeEntry?.timer.status ?? 'idle'
  const effectiveSeconds = Math.max(0, Math.round(activeEntry?.timer.effectiveSeconds ?? 0))
  const scene = activeEntry?.scene ?? null
  const sceneLabel = scene ? TIMER_FOCUS_SCENE_LABELS[scene] : '学习计时'
  const primaryText = !activeEntry
    ? '当前无学习会话'
    : status === 'running'
      ? '正在计时'
      : status === 'paused'
        ? '已暂停'
        : status === 'completed'
          ? '已完成'
          : '等待开始'
  const secondaryText = activeEntry
    ? `有效学习时间 ${formatClock(effectiveSeconds)}`
    : '进入学习页面后手动开始'
  const availableActions: UnifiedTimerAction[] = !activeEntry
    ? []
    : status === 'running'
      ? ['pause'] as UnifiedTimerAction[]
      : status === 'paused' || status === 'idle'
        ? ['resume'] as UnifiedTimerAction[]
        : []

  return {
    mode: 'study',
    status,
    ownerSessionId: activeEntry?.sessionId ?? null,
    ownerSessionKey: activeEntry?.timer.sessionKey ?? null,
    title: activeEntry?.title ?? '待开始',
    scene: sceneLabel,
    displaySeconds: activeEntry ? effectiveSeconds : null,
    primaryText,
    secondaryText,
    snoozeCount: 0,
    availableActions,
    presetMinutes: [],
    allowCustomMinutes: false,
    snoozeMinutes: [],
    targetPath: activeEntry?.routePath ?? '/freestyle',
    updatedAt: Date.now(),
    effectiveSeconds,
    semanticState:
      status === 'running' ? 'running' : status === 'paused' ? 'paused' : status === 'completed' ? 'paused' : 'idle',
    progressMode: status === 'paused' ? 'frozen' : status === 'idle' ? 'empty' : 'elapsed',
    progressValue: 0,
  }
}

/** Legacy snapshots are intentionally no longer produced. */
export function createBreakLogId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `break-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** @deprecated Break countdowns were removed; retain a stable empty study snapshot for old imports. */
export function buildBreakTimerSnapshot(_options?: unknown) {
  return buildStudyTimerSnapshot({ activeEntry: null })
}

/** Compatibility helper for consumers that only have an entry list. */
export function buildActiveStudyTimerSnapshot(entries: GlobalTimerRegistration[]) {
  return buildStudyTimerSnapshot({ activeEntry: selectActiveTimerEntry(entries) })
}

export function formatTimerSnapshotClock(seconds: number | null) {
  if (seconds == null) return '--:--'
  return formatClock(seconds)
}
