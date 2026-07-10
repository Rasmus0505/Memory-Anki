import * as React from 'react'
import type {
  SessionCompletionMethod,
  TimeSessionRecord,
} from '@/entities/session/model/session-records'
import { formatLocalApiDateTime } from '@/shared/lib/dateTime'
import { clearTimedSessionTimeout } from '@/shared/hooks/timedSessionBrowserEffects'
import type {
  ResolvedTimedSessionAutomation,
  SessionStatus,
  TimedSessionMeta,
} from '@/shared/hooks/timedSessionModel'

export function buildSuspendedSceneLeaveState(input: {
  currentMs: number
  resumeWindowMs: number
  meta?: TimedSessionMeta
  includePersistedRecord?: boolean
  includeUnloadPersisted?: boolean
}): {
  suspendedAt: string
  resumeDeadlineAt: string
  persistedLeaveMeta: TimedSessionMeta
} {
  const suspendedAt = formatLocalApiDateTime(new Date(input.currentMs))
  const resumeDeadlineAt = formatLocalApiDateTime(
    new Date(input.currentMs + input.resumeWindowMs),
  )
  return {
    suspendedAt,
    resumeDeadlineAt,
    persistedLeaveMeta: {
      ...(input.meta ?? {}),
      ...(input.includePersistedRecord ? { persisted_record: true } : {}),
      ...(input.includeUnloadPersisted ? { unload_persisted: true } : {}),
    },
  }
}

export function useTimedSessionSceneLeave(input: {
  startedAtRef: React.RefObject<string | null>
  statusRef: React.RefObject<SessionStatus>
  leaveHandledRef: React.RefObject<boolean>
  autoPauseRef: React.RefObject<number | null>
  autoPauseDeadlineAtRef: React.RefObject<number | null>
  hiddenPauseRef: React.RefObject<number | null>
  sceneActiveRef: React.RefObject<boolean>
  idleSecondsRef: React.RefObject<number>
  lastTickPersistAtRef: React.RefObject<number | null>
  suspendedAtRef: React.RefObject<string | null>
  resumeDeadlineAtRef: React.RefObject<string | null>
  leaveMetaRef: React.RefObject<TimedSessionMeta | null>
  resolvedAutomation: ResolvedTimedSessionAutomation
  stopTicker: (currentMs?: number) => void
  closeActiveSceneSegment: (endedAt?: string) => void
  pushEvent: (
    type: 'leave_scene',
    meta?: TimedSessionMeta,
    options?: { persist?: boolean },
  ) => void
  persistSnapshot: (options?: {
    statusOverride?: 'running' | 'paused'
    suspended?: boolean
    suspendedAt?: string | null
    resumeDeadlineAt?: string | null
    leaveMeta?: TimedSessionMeta | null
  }) => void
  buildRecord: (
    method: SessionCompletionMethod,
    endedAt?: string,
  ) => TimeSessionRecord | null
  persistRecord: (record: TimeSessionRecord | null) => Promise<TimeSessionRecord | null>
  persistRecordForUnload: (record: TimeSessionRecord | null) => Promise<TimeSessionRecord | null>
  setStatus: React.Dispatch<React.SetStateAction<SessionStatus>>
  setGlowState: React.Dispatch<React.SetStateAction<'idle' | 'running' | 'paused'>>
  setIdleSeconds: React.Dispatch<React.SetStateAction<number>>
}) {
  const {
    startedAtRef,
    statusRef,
    leaveHandledRef,
    autoPauseRef,
    autoPauseDeadlineAtRef,
    hiddenPauseRef,
    sceneActiveRef,
    idleSecondsRef,
    lastTickPersistAtRef,
    suspendedAtRef,
    resumeDeadlineAtRef,
    leaveMetaRef,
    resolvedAutomation,
    stopTicker,
    closeActiveSceneSegment,
    pushEvent,
    persistSnapshot,
    buildRecord,
    persistRecord,
    persistRecordForUnload,
    setStatus,
    setGlowState,
    setIdleSeconds,
  } = input

  const leaveSceneWithPersistence = React.useCallback(
    async (
      meta: TimedSessionMeta | undefined,
      persistRecordForLeave: (record: TimeSessionRecord | null) => Promise<TimeSessionRecord | null>,
      options?: { unload?: boolean },
    ) => {
      if (!startedAtRef.current || statusRef.current === 'completed' || leaveHandledRef.current) {
        return null
      }
      leaveHandledRef.current = true
      const currentMs = Date.now()
      const { suspendedAt, resumeDeadlineAt, persistedLeaveMeta } =
        buildSuspendedSceneLeaveState({
          currentMs,
          resumeWindowMs: resolvedAutomation.resumeWindowMs,
          meta,
          includePersistedRecord: true,
          includeUnloadPersisted: options?.unload,
        })

      stopTicker(currentMs)
      clearTimedSessionTimeout(autoPauseRef)
      autoPauseDeadlineAtRef.current = null
      clearTimedSessionTimeout(hiddenPauseRef)
      statusRef.current = 'paused'
      if (options?.unload) {
        lastTickPersistAtRef.current = null
      }
      setStatus('paused')
      setGlowState('idle')
      sceneActiveRef.current = false
      idleSecondsRef.current = 0
      setIdleSeconds(0)
      closeActiveSceneSegment(suspendedAt)
      pushEvent('leave_scene', meta, { persist: false })
      suspendedAtRef.current = suspendedAt
      resumeDeadlineAtRef.current = resumeDeadlineAt
      leaveMetaRef.current = persistedLeaveMeta
      persistSnapshot({
        statusOverride: 'paused',
        suspended: true,
        suspendedAt,
        resumeDeadlineAt,
        leaveMeta: persistedLeaveMeta,
      })
      const record = buildRecord('left_page', suspendedAt)
      return persistRecordForLeave(record)
    },
    [
      autoPauseRef,
      autoPauseDeadlineAtRef,
      buildRecord,
      closeActiveSceneSegment,
      hiddenPauseRef,
      idleSecondsRef,
      lastTickPersistAtRef,
      leaveHandledRef,
      leaveMetaRef,
      persistSnapshot,
      pushEvent,
      resolvedAutomation.resumeWindowMs,
      resumeDeadlineAtRef,
      sceneActiveRef,
      setGlowState,
      setIdleSeconds,
      setStatus,
      startedAtRef,
      statusRef,
      stopTicker,
      suspendedAtRef,
    ],
  )

  const leaveScene = React.useCallback(
    (meta?: TimedSessionMeta) => leaveSceneWithPersistence(meta, persistRecord),
    [leaveSceneWithPersistence, persistRecord],
  )

  const leaveSceneForUnload = React.useCallback(
    (meta?: TimedSessionMeta) => leaveSceneWithPersistence(meta, persistRecordForUnload, { unload: true }),
    [leaveSceneWithPersistence, persistRecordForUnload],
  )

  return { leaveScene, leaveSceneForUnload }
}
