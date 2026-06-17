import * as React from 'react'
import type {
  SessionEventRecord,
  TimeSessionRecord,
} from '@/entities/session/model'
import {
  createStableRecordId,
  type ActiveSceneSegmentSnapshot,
  type GlowState,
  type RestorableTimedSessionSnapshot,
  type SessionSceneSegment,
  type SessionStatus,
} from './timedSessionModel'
import {
  isExpiredSuspendedSnapshot,
  readRestorableTimedSessionSnapshot,
  resolveRestoredTimedSessionSnapshot,
} from './timedSessionSnapshot'

interface TimedSessionRestoreOptions {
  storageKey: string | null
  restoredStorageKeyRef: React.MutableRefObject<string | null>
  recordIdRef: React.MutableRefObject<string | null>
  eventsRef: React.MutableRefObject<SessionEventRecord[]>
  sceneSegmentsRef: React.MutableRefObject<SessionSceneSegment[]>
  activeSceneSegmentRef: React.MutableRefObject<ActiveSceneSegmentSnapshot | null>
  effectiveSecondsRef: React.MutableRefObject<number>
  idleSecondsRef: React.MutableRefObject<number>
  pauseCountRef: React.MutableRefObject<number>
  startedAtRef: React.MutableRefObject<string | null>
  durationEditedRef: React.MutableRefObject<boolean>
  lastActivityAtRef: React.MutableRefObject<number | null>
  suspendedAtRef: React.MutableRefObject<string | null>
  resumeDeadlineAtRef: React.MutableRefObject<string | null>
  leaveMetaRef: React.MutableRefObject<RestorableTimedSessionSnapshot['leaveMeta']>
  sceneActiveRef: React.MutableRefObject<boolean>
  statusRef: React.MutableRefObject<SessionStatus>
  setEffectiveSeconds: React.Dispatch<React.SetStateAction<number>>
  setIdleSeconds: React.Dispatch<React.SetStateAction<number>>
  setPauseCount: React.Dispatch<React.SetStateAction<number>>
  setStartedAt: React.Dispatch<React.SetStateAction<string | null>>
  setDurationEdited: React.Dispatch<React.SetStateAction<boolean>>
  setGlowState: React.Dispatch<React.SetStateAction<GlowState>>
  setStatus: React.Dispatch<React.SetStateAction<SessionStatus>>
  clearPersistedSnapshot: () => void
  clearCompetingSnapshots: () => void
  persistExpiredSuspendedSnapshot: (
    snapshot: RestorableTimedSessionSnapshot,
  ) => Promise<TimeSessionRecord | null>
  persistSnapshot: () => void
  resumeSuspendedScene: () => boolean
  startTicker: () => void
  armAutoPause: () => void
}

export function useTimedSessionSnapshotRestore({
  storageKey,
  restoredStorageKeyRef,
  recordIdRef,
  eventsRef,
  sceneSegmentsRef,
  activeSceneSegmentRef,
  effectiveSecondsRef,
  idleSecondsRef,
  pauseCountRef,
  startedAtRef,
  durationEditedRef,
  lastActivityAtRef,
  suspendedAtRef,
  resumeDeadlineAtRef,
  leaveMetaRef,
  sceneActiveRef,
  statusRef,
  setEffectiveSeconds,
  setIdleSeconds,
  setPauseCount,
  setStartedAt,
  setDurationEdited,
  setGlowState,
  setStatus,
  clearPersistedSnapshot,
  clearCompetingSnapshots,
  persistExpiredSuspendedSnapshot,
  persistSnapshot,
  resumeSuspendedScene,
  startTicker,
  armAutoPause,
}: TimedSessionRestoreOptions) {
  React.useEffect(() => {
    if (!storageKey || restoredStorageKeyRef.current === storageKey) return
    restoredStorageKeyRef.current = storageKey
    const parsed = readRestorableTimedSessionSnapshot(storageKey)
    if (!parsed?.startedAt) {
      clearPersistedSnapshot()
      return
    }

    if (isExpiredSuspendedSnapshot(parsed)) {
      void persistExpiredSuspendedSnapshot(parsed)
      clearPersistedSnapshot()
      return
    }

    const restored = resolveRestoredTimedSessionSnapshot(parsed)
    const restoredEffectiveSeconds = restored.effectiveSeconds

    recordIdRef.current = parsed.recordId ?? createStableRecordId()
    eventsRef.current = Array.isArray(parsed.events) ? parsed.events : []
    sceneSegmentsRef.current = Array.isArray(parsed.sceneSegments) ? parsed.sceneSegments : []
    activeSceneSegmentRef.current = parsed.activeSceneSegment ?? null
    effectiveSecondsRef.current = restoredEffectiveSeconds
    idleSecondsRef.current = 0
    pauseCountRef.current = Math.max(0, Math.round(parsed.pauseCount || 0))
    startedAtRef.current = parsed.startedAt
    durationEditedRef.current = Boolean(parsed.durationEdited)
    lastActivityAtRef.current = Date.now()

    setEffectiveSeconds(restoredEffectiveSeconds)
    setIdleSeconds(0)
    setPauseCount(pauseCountRef.current)
    setStartedAt(parsed.startedAt)
    setDurationEdited(Boolean(parsed.durationEdited))
    setGlowState('idle')
    clearCompetingSnapshots()

    if (parsed.suspended) {
      suspendedAtRef.current = parsed.suspendedAt
      resumeDeadlineAtRef.current = parsed.resumeDeadlineAt
      leaveMetaRef.current = parsed.leaveMeta ?? null
      activeSceneSegmentRef.current = null
      sceneActiveRef.current = true
      resumeSuspendedScene()
      return
    }

    if (parsed.status === 'paused') {
      statusRef.current = 'paused'
      sceneActiveRef.current = true
      setStatus('paused')
      persistSnapshot()
      return
    }

    statusRef.current = 'running'
    sceneActiveRef.current = true
    setStatus('running')
    startTicker()
    armAutoPause()
    persistSnapshot()
  }, [
    activeSceneSegmentRef,
    armAutoPause,
    clearCompetingSnapshots,
    clearPersistedSnapshot,
    durationEditedRef,
    effectiveSecondsRef,
    eventsRef,
    idleSecondsRef,
    lastActivityAtRef,
    leaveMetaRef,
    pauseCountRef,
    persistExpiredSuspendedSnapshot,
    persistSnapshot,
    recordIdRef,
    restoredStorageKeyRef,
    resumeDeadlineAtRef,
    resumeSuspendedScene,
    sceneActiveRef,
    statusRef,
    sceneSegmentsRef,
    setDurationEdited,
    setEffectiveSeconds,
    setGlowState,
    setIdleSeconds,
    setPauseCount,
    setStartedAt,
    setStatus,
    startTicker,
    startedAtRef,
    storageKey,
    suspendedAtRef,
  ])
}
