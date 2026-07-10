import * as React from 'react'
import { markDirty } from '@/shared/persistence/autosaveCoordinator'
import {
  clearTimedSessionTimeout,
} from './timedSessionBrowserEffects'
import type {
  ResolvedTimedSessionAutomation,
  SessionStatus,
  TimedSessionMeta,
} from './timedSessionModel'

export function getIdleSecondsAt(input: {
  lastActivityAtMs: number | null
  currentMs: number
}) {
  if (input.lastActivityAtMs == null) return 0
  return Math.max(0, Math.floor((input.currentMs - input.lastActivityAtMs) / 1000))
}

export function calculateAutoPauseTransition(input: {
  effectiveSeconds: number
  pauseCount: number
  idleSecondsAtPause: number
  maxRollbackSeconds: number
}) {
  const rollbackSeconds = Math.min(
    Math.max(0, input.maxRollbackSeconds),
    Math.max(0, input.idleSecondsAtPause),
  )
  return {
    rollbackSeconds,
    effectiveSeconds: Math.max(0, input.effectiveSeconds - rollbackSeconds),
    idleSeconds: 0,
    pauseCount: input.pauseCount + 1,
  }
}

export function useTimedSessionAutoPause(input: {
  statusRef: React.RefObject<SessionStatus>
  autoPauseRef: React.RefObject<number | null>
  autoPauseDeadlineAtRef: React.RefObject<number | null>
  lastActivityAtRef: React.RefObject<number | null>
  effectiveSecondsRef: React.RefObject<number>
  idleSecondsRef: React.RefObject<number>
  pauseCountRef: React.RefObject<number>
  resolvedAutomation: ResolvedTimedSessionAutomation
  timedSessionAutoSaveKey: string
  stopTicker: (currentMs?: number) => void
  pushEvent: (
    type: 'pause',
    meta?: TimedSessionMeta,
    options?: { persist?: boolean },
  ) => void
  persistSnapshot: () => void
  setStatus: React.Dispatch<React.SetStateAction<SessionStatus>>
  setGlowState: React.Dispatch<React.SetStateAction<'idle' | 'running' | 'paused'>>
  setEffectiveSeconds: React.Dispatch<React.SetStateAction<number>>
  setIdleSeconds: React.Dispatch<React.SetStateAction<number>>
  setPauseCount: React.Dispatch<React.SetStateAction<number>>
}) {
  const {
    statusRef,
    autoPauseRef,
    autoPauseDeadlineAtRef,
    lastActivityAtRef,
    effectiveSecondsRef,
    idleSecondsRef,
    pauseCountRef,
    resolvedAutomation,
    timedSessionAutoSaveKey,
    stopTicker,
    pushEvent,
    persistSnapshot,
    setStatus,
    setGlowState,
    setEffectiveSeconds,
    setIdleSeconds,
    setPauseCount,
  } = input

  return React.useCallback((deadlineAtMs?: number) => {
    clearTimedSessionTimeout(autoPauseRef)
    if (statusRef.current !== 'running') return
    const resolvedDeadlineAtMs = Number.isFinite(deadlineAtMs)
      ? Number(deadlineAtMs)
      : Date.now() + resolvedAutomation.autoPauseMs
    autoPauseDeadlineAtRef.current = resolvedDeadlineAtMs
    autoPauseRef.current = window.setTimeout(() => {
      if (statusRef.current !== 'running') return
      const pausedAtMs = Date.now()
      stopTicker(pausedAtMs)
      const idleSecondsAtPause = getIdleSecondsAt({
        lastActivityAtMs: lastActivityAtRef.current,
        currentMs: pausedAtMs,
      })
      const next = calculateAutoPauseTransition({
        effectiveSeconds: effectiveSecondsRef.current,
        pauseCount: pauseCountRef.current,
        idleSecondsAtPause,
        maxRollbackSeconds: resolvedAutomation.autoPauseRollbackSeconds,
      })
      autoPauseRef.current = null
      autoPauseDeadlineAtRef.current = null
      pauseCountRef.current = next.pauseCount
      setPauseCount(next.pauseCount)
      statusRef.current = 'paused'
      setStatus('paused')
      setGlowState('paused')
      effectiveSecondsRef.current = next.effectiveSeconds
      setEffectiveSeconds(next.effectiveSeconds)
      idleSecondsRef.current = next.idleSeconds
      setIdleSeconds(next.idleSeconds)
      pushEvent('pause', {
        reason: 'inactive',
        idle_seconds: idleSecondsAtPause,
        rollback_seconds: next.rollbackSeconds,
        warning_seconds: Math.round(resolvedAutomation.inactivityWarningMs / 1000),
        grace_seconds: Math.round(resolvedAutomation.inactivityGraceMs / 1000),
      })
      persistSnapshot()
      markDirty(timedSessionAutoSaveKey, 'auto_pause')
    }, Math.max(0, resolvedDeadlineAtMs - Date.now()))
  }, [
    autoPauseDeadlineAtRef,
    autoPauseRef,
    effectiveSecondsRef,
    idleSecondsRef,
    lastActivityAtRef,
    pauseCountRef,
    persistSnapshot,
    pushEvent,
    resolvedAutomation,
    setEffectiveSeconds,
    setGlowState,
    setIdleSeconds,
    setPauseCount,
    setStatus,
    statusRef,
    stopTicker,
    timedSessionAutoSaveKey,
  ])
}
