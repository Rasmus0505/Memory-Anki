import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'

export type BreakGuardStatus = 'idle' | 'prompting' | 'counting_down' | 'expired' | 'dismissed'

export interface BreakGuardState {
  status: BreakGuardStatus
  startedAt: number | null
  plannedMinutes: number | null
  expiresAt: number | null
  snoozeCount: number
  logId: string | null
}

export const IDLE_BREAK_GUARD_STATE: BreakGuardState = {
  status: 'idle',
  startedAt: null,
  plannedMinutes: null,
  expiresAt: null,
  snoozeCount: 0,
  logId: null,
}

export function createBreakGuardCountdown(
  minutes: number,
  now = Date.now(),
  logId: string | null = null,
): BreakGuardState {
  const plannedMinutes = Math.max(1, Math.round(minutes))
  return {
    status: 'counting_down',
    startedAt: now,
    plannedMinutes,
    expiresAt: now + plannedMinutes * 60_000,
    snoozeCount: 0,
    logId,
  }
}

export function expireBreakGuardIfDue(state: BreakGuardState, now = Date.now()): BreakGuardState {
  if (state.status !== 'counting_down' || state.expiresAt == null || now < state.expiresAt) {
    return state
  }
  return {
    ...state,
    status: 'expired',
  }
}

export function snoozeBreakGuard(state: BreakGuardState, minutes: number, now = Date.now()): BreakGuardState {
  const snoozeMinutes = Math.max(1, Math.round(minutes))
  return {
    ...state,
    status: 'counting_down',
    expiresAt: now + snoozeMinutes * 60_000,
    snoozeCount: state.snoozeCount + 1,
  }
}

export function formatBreakGuardClock(milliseconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = `${Math.floor(safeSeconds / 60)}`.padStart(2, '0')
  const seconds = `${safeSeconds % 60}`.padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function shouldPromptForBreakGuard(config: BreakGuardConfig, state: BreakGuardState) {
  return config.enabled && (state.status === 'idle' || state.status === 'dismissed')
}
