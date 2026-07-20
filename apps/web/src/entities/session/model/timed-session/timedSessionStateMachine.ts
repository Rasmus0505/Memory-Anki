import * as React from 'react'
import { useStableTimedSessionController } from './useStableTimedSessionController'
import {
  removePendingTimeRecordRecovery,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type TimeSessionRecord,
} from '@/entities/session/model'
import {
  getTimerAutomationRule,
  readTimerAutomationConfig,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  advanceTickState,
  buildTimedSessionController,
  createStableRecordId,
  DEFAULT_TIMED_SESSION_FOCUS_ROUND,
  nowIso,
  resolveTimedSessionAutomation,
  type ActiveSceneSegmentSnapshot,
  type GlowState,
  type PersistedSessionStatus,
  type RestorableTimedSessionSnapshot,
  type SessionSceneSegment,
  type SessionStatus,
  type TimedSessionMeta,
  type TimedSessionFocusRoundState,
  type TimedSessionOptions,
} from '@/shared/hooks/timedSessionModel'
import {
  buildTimedSessionStorageKey,
  clearCompetingTimedSessionSnapshots,
  clearPersistedTimedSessionSnapshot,
} from '@/shared/hooks/timedSessionStorage'
import {
  buildPersistedTimedSessionSnapshot,
  buildRestorableTimedSessionSnapshot,
  writePersistedTimedSessionSnapshot,
} from '@/shared/hooks/timedSessionSnapshot'
import { markDirty, registerAutoSaveTarget } from '@/shared/persistence/autosaveCoordinator'
import { useTimedSessionAutoPause } from '@/shared/hooks/timedSessionAutoPause'
import {
  clearTimedSessionInterval,
  clearTimedSessionTimeout,
  useTimedSessionAutomationConfigSubscription,
  useTimedSessionBrowserPauseEffects,
  useTimedSessionGlowReset,
  useTimedSessionUnloadPersistence,
} from '@/shared/hooks/timedSessionBrowserEffects'
import { fireAndQueueTimeRecordOnUnload } from '@/shared/hooks/timedSessionRecovery'
import { useTimedSessionSnapshotRestore } from '@/shared/hooks/timedSessionRestore'
import {
  buildSuspendedSceneLeaveState,
  useTimedSessionSceneLeave,
} from './timedSessionSceneLeave'
import { useTimedSessionActivityActions } from './useTimedSessionActivityActions'
import { useTimedSessionFocusActions } from './useTimedSessionFocusActions'
import {
  closeSceneSegment,
  createActiveSceneSegment,
} from './timedSessionSegments'
import {
  buildRecordFromExpiredSuspendedTimedSessionSnapshot,
  buildTimedSessionRecord,
  persistTimedSessionRecord,
  saveInProgressTimedSessionRecord,
} from './timedSessionRecordBuilder'

export function useTimedSession({
  kind,
  title,
  palaceId,
  automationScene = kind,
  sourceKind = null,
  englishCourseId = null,
  autoPauseMs,
  hiddenPauseMs,
  persistKey = null,
  persistCompletionRecord = true,
}: TimedSessionOptions) {
  const sessionScene = automationScene
  const sessionIdRef = React.useRef(createStableRecordId())
  const [effectiveSeconds, setEffectiveSeconds] = React.useState(0)
  const [idleSeconds, setIdleSeconds] = React.useState(0)
  const [pauseCount, setPauseCount] = React.useState(0)
  const [status, setStatus] = React.useState<SessionStatus>('idle')
  const [startedAt, setStartedAt] = React.useState<string | null>(null)
  const [durationEdited, setDurationEdited] = React.useState(false)
  const [glowState, setGlowState] = React.useState<GlowState>('idle')
  const [focusRound, setFocusRound] = React.useState<TimedSessionFocusRoundState>(() => ({
    ...DEFAULT_TIMED_SESSION_FOCUS_ROUND,
  }))

  const statusRef = React.useRef<SessionStatus>('idle')
  const recordIdRef = React.useRef<string | null>(null)
  const lastTickAtRef = React.useRef<number | null>(null)
  const lastActivityAtRef = React.useRef<number | null>(null)
  const eventsRef = React.useRef<SessionEventRecord[]>([])
  const effectiveSecondsRef = React.useRef(0)
  const idleSecondsRef = React.useRef(0)
  const pauseCountRef = React.useRef(0)
  const startedAtRef = React.useRef<string | null>(null)
  const durationEditedRef = React.useRef(false)
  const tickerRef = React.useRef<number | null>(null)
  const autoPauseRef = React.useRef<number | null>(null)
  const autoPauseDeadlineAtRef = React.useRef<number | null>(null)
  const hiddenPauseRef = React.useRef<number | null>(null)
  const restoredStorageKeyRef = React.useRef<string | null>(null)
  const leaveHandledRef = React.useRef(false)
  const sceneActiveRef = React.useRef(true)
  const suspendedAtRef = React.useRef<string | null>(null)
  const resumeDeadlineAtRef = React.useRef<string | null>(null)
  const leaveMetaRef = React.useRef<TimedSessionMeta | null>(null)
  const sceneSegmentsRef = React.useRef<SessionSceneSegment[]>([])
  const activeSceneSegmentRef = React.useRef<ActiveSceneSegmentSnapshot | null>(null)
  const focusRoundRef = React.useRef<TimedSessionFocusRoundState>({
    ...DEFAULT_TIMED_SESSION_FOCUS_ROUND,
  })
  const lastTickPersistAtRef = React.useRef<number | null>(null)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const timedSessionAutoSaveKey = React.useMemo(() => `timed-session:${sessionIdRef.current}`, [])

  const resolvedAutomation = React.useMemo(
    () => resolveTimedSessionAutomation(getTimerAutomationRule(automationScene, automationConfig), { autoPauseMs, hiddenPauseMs }),
    [autoPauseMs, automationConfig, automationScene, hiddenPauseMs],
  )

  const storageKey = persistKey ? buildTimedSessionStorageKey(persistKey) : null

  const clearPersistedSnapshot = React.useCallback(() => clearPersistedTimedSessionSnapshot(storageKey), [storageKey])
  const clearCompetingSnapshots = React.useCallback(() => clearCompetingTimedSessionSnapshots(storageKey), [storageKey])

  const persistSnapshot = React.useCallback(
    (options?: {
      statusOverride?: PersistedSessionStatus
      suspended?: boolean
      suspendedAt?: string | null
      resumeDeadlineAt?: string | null
      leaveMeta?: TimedSessionMeta | null
    }) => {
      if (!storageKey) return
      const snapshotStatus = options?.statusOverride ?? statusRef.current
      if (
        !startedAtRef.current ||
        (snapshotStatus !== 'running' && snapshotStatus !== 'paused')
      ) {
        clearPersistedSnapshot()
        return
      }
      const snapshot = buildPersistedTimedSessionSnapshot({
        recordId: recordIdRef.current,
        kind,
        palaceId,
        sourceKind,
        englishCourseId,
        title,
        effectiveSeconds: effectiveSecondsRef.current,
        pauseCount: pauseCountRef.current,
        status: snapshotStatus,
        startedAt: startedAtRef.current,
        durationEdited: durationEditedRef.current,
        events: [...eventsRef.current],
        sceneSegments: [...sceneSegmentsRef.current],
        activeSceneSegment: activeSceneSegmentRef.current,
        focusRound: focusRoundRef.current,
        lastActivityAtMs: lastActivityAtRef.current,
        autoPauseDeadlineAtMs: autoPauseDeadlineAtRef.current,
      }, options)
      writePersistedTimedSessionSnapshot(storageKey, snapshot)
    },
    [clearPersistedSnapshot, englishCourseId, kind, palaceId, sourceKind, storageKey, title],
  )

  const clearSuspendedState = React.useCallback(() => {
    suspendedAtRef.current = null
    resumeDeadlineAtRef.current = null
    leaveMetaRef.current = null
    leaveHandledRef.current = false
  }, [])

  const buildActiveSceneSegment = React.useCallback((): ActiveSceneSegmentSnapshot => (
    createActiveSceneSegment({
      scene: sessionScene,
      kind,
      palaceId,
      sourceKind,
      englishCourseId,
      title,
      startedAt: nowIso(),
      effectiveSecondsAtStart: effectiveSecondsRef.current,
    })
  ), [englishCourseId, kind, palaceId, sessionScene, sourceKind, title])

  const maybeStartSceneSegment = React.useCallback(() => {
    if (activeSceneSegmentRef.current) return
    activeSceneSegmentRef.current = buildActiveSceneSegment()
  }, [buildActiveSceneSegment])

  const closeActiveSceneSegment = React.useCallback((endedAt = nowIso()) => {
    const next = closeSceneSegment({
      active: activeSceneSegmentRef.current,
      segments: sceneSegmentsRef.current,
      endedAt,
      effectiveSecondsNow: effectiveSecondsRef.current,
    })
    sceneSegmentsRef.current = next.segments
    activeSceneSegmentRef.current = next.active
  }, [])

  const ensureRecordId = React.useCallback(() => {
    if (!recordIdRef.current) {
      recordIdRef.current = createStableRecordId()
    }
    return recordIdRef.current
  }, [])

  const pushEvent = React.useCallback((
    type: SessionEventRecord['type'],
    meta?: TimedSessionMeta,
    options?: { persist?: boolean },
  ) => {
    eventsRef.current.push({ type, at: nowIso(), ...(meta ? { meta } : {}) })
    if (options?.persist !== false) {
      persistSnapshot()
    }
  }, [persistSnapshot])

  const syncTick = React.useCallback((currentMs = Date.now()) => {
    if (statusRef.current !== 'running' || lastTickAtRef.current == null) return
    const tickState = advanceTickState({
      previousEffectiveSeconds: effectiveSecondsRef.current,
      previousIdleSeconds: idleSecondsRef.current,
      lastTickAtMs: lastTickAtRef.current,
      lastActivityAtMs: lastActivityAtRef.current,
      currentMs,
    })
    if (tickState.effectiveChanged) {
      effectiveSecondsRef.current = tickState.effectiveSeconds
      setEffectiveSeconds(effectiveSecondsRef.current)
    }
    lastTickAtRef.current = tickState.lastTickAtMs
    if (tickState.idleChanged) {
      idleSecondsRef.current = tickState.idleSeconds
      setIdleSeconds(tickState.idleSeconds)
    }
    const changed = tickState.effectiveChanged || tickState.idleChanged
    if (changed && (lastTickPersistAtRef.current == null || currentMs - lastTickPersistAtRef.current >= 5_000)) {
      lastTickPersistAtRef.current = currentMs
      persistSnapshot()
      markDirty(timedSessionAutoSaveKey, 'tick')
    }
  }, [persistSnapshot, timedSessionAutoSaveKey])

  const startTicker = React.useCallback(() => {
    clearTimedSessionInterval(tickerRef)
    lastTickAtRef.current = Date.now()
    tickerRef.current = window.setInterval(() => {
      syncTick()
    }, 250)
  }, [syncTick])

  const stopTicker = React.useCallback((currentMs?: number) => {
    syncTick(currentMs)
    clearTimedSessionInterval(tickerRef)
    lastTickAtRef.current = null
  }, [syncTick])

  const buildRecord = React.useCallback((
    method: SessionCompletionMethod,
    endedAt = nowIso(),
  ): TimeSessionRecord | null => {
    if (!startedAtRef.current) return null
    closeActiveSceneSegment(endedAt)
    return buildTimedSessionRecord({
      id: ensureRecordId(),
      kind,
      palaceId,
      sourceKind,
      englishCourseId,
      title,
      startedAt: startedAtRef.current,
      endedAt,
      effectiveSeconds: effectiveSecondsRef.current,
      pauseCount: pauseCountRef.current,
      completionMethod: method,
      durationEdited: durationEditedRef.current,
      events: eventsRef.current,
      sceneSegments: sceneSegmentsRef.current,
    })
  }, [closeActiveSceneSegment, englishCourseId, ensureRecordId, kind, palaceId, sourceKind, title])

  // Formal review keeps a local timer only. Study-session rows (and mastery
  // receipts) must come from /review/session/{id}/submit — never from leave,
  // autosave, unload, or complete. Otherwise ghost scene=review rows appear in
  // time records while mastery trend stays empty.
  const persistRecord = React.useCallback(async (
    record: TimeSessionRecord | null,
  ) => {
    if (!persistCompletionRecord) {
      return record
    }
    return persistTimedSessionRecord(record)
  }, [persistCompletionRecord])

  const saveInProgressRecord = React.useCallback(async () => {
    if (!persistCompletionRecord) {
      return
    }
    await saveInProgressTimedSessionRecord({
      startedAt: startedAtRef.current,
      completed: statusRef.current === 'completed',
      buildRecord: () => buildRecord('saved', nowIso()),
      persistRecord,
    })
  }, [buildRecord, persistCompletionRecord, persistRecord])

  const persistExpiredSuspendedSnapshot = React.useCallback(async (
    snapshot: RestorableTimedSessionSnapshot,
  ) => {
    if (!persistCompletionRecord) {
      return null
    }
    return persistRecord(buildRecordFromExpiredSuspendedTimedSessionSnapshot(snapshot))
  }, [persistCompletionRecord, persistRecord])

  const finalizeExpiredSuspendedState = React.useCallback(() => {
    const pendingSnapshot: RestorableTimedSessionSnapshot | null =
      startedAtRef.current && suspendedAtRef.current
        ? buildRestorableTimedSessionSnapshot({
            recordId: recordIdRef.current,
            kind,
            palaceId,
            sourceKind,
            englishCourseId,
            title,
            effectiveSeconds: effectiveSecondsRef.current,
            pauseCount: pauseCountRef.current,
            status: 'paused',
            startedAt: startedAtRef.current,
            durationEdited: durationEditedRef.current,
            events: [...eventsRef.current],
            sceneSegments: [...sceneSegmentsRef.current],
            activeSceneSegment: activeSceneSegmentRef.current,
            focusRound: focusRoundRef.current,
            lastActivityAtMs: lastActivityAtRef.current,
            autoPauseDeadlineAtMs: autoPauseDeadlineAtRef.current,
          }, {
            suspended: true,
            suspendedAt: suspendedAtRef.current,
            resumeDeadlineAt: resumeDeadlineAtRef.current,
            leaveMeta: leaveMetaRef.current,
          })
        : null
    clearSuspendedState()
    if (pendingSnapshot) {
      void persistExpiredSuspendedSnapshot(pendingSnapshot)
    }
    if (statusRef.current === 'paused') {
      persistSnapshot({
        statusOverride: 'paused',
      })
      return
    }
    clearPersistedSnapshot()
  }, [
    clearPersistedSnapshot,
    clearSuspendedState,
    englishCourseId,
    kind,
    palaceId,
    persistExpiredSuspendedSnapshot,
    persistSnapshot,
    sourceKind,
    title,
  ])

  const armAutoPause = useTimedSessionAutoPause({
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
  })

  const beginRunning = React.useCallback((eventType: 'start' | 'resume', meta?: TimedSessionMeta) => {
    const nextStartedAt = startedAtRef.current ?? nowIso()
    sceneActiveRef.current = true
    setStartedAt(nextStartedAt)
    startedAtRef.current = nextStartedAt
    ensureRecordId()
    clearSuspendedState()
    lastActivityAtRef.current = Date.now()
    lastTickPersistAtRef.current = null
    idleSecondsRef.current = 0
    setIdleSeconds(0)
    statusRef.current = 'running'
    setStatus('running')
    setGlowState('running')
    maybeStartSceneSegment()
    startTicker()
    armAutoPause()
    pushEvent(eventType, meta)
    persistSnapshot()
    markDirty(timedSessionAutoSaveKey, eventType)
  }, [armAutoPause, clearSuspendedState, ensureRecordId, maybeStartSceneSegment, persistSnapshot, pushEvent, startTicker, timedSessionAutoSaveKey])

  const resumeSuspendedScene = React.useCallback(
    (meta?: TimedSessionMeta) => {
      if (!startedAtRef.current || !suspendedAtRef.current || !resumeDeadlineAtRef.current) {
        return false
      }
      const deadlineMs = new Date(resumeDeadlineAtRef.current).getTime()
      if (!Number.isFinite(deadlineMs) || Date.now() > deadlineMs) {
        finalizeExpiredSuspendedState()
        return false
      }

      const previousLeaveMeta = leaveMetaRef.current
      clearSuspendedState()
      lastActivityAtRef.current = Date.now()
      idleSecondsRef.current = 0
      setIdleSeconds(0)
      statusRef.current = 'running'
      setStatus('running')
      setGlowState('running')
      maybeStartSceneSegment()
      startTicker()
      armAutoPause()
      pushEvent('resume', {
        reason: 'scene_return',
        ...(previousLeaveMeta ?? {}),
        ...(meta ?? {}),
      })
      persistSnapshot()
      return true
    },
    [armAutoPause, clearSuspendedState, finalizeExpiredSuspendedState, maybeStartSceneSegment, persistSnapshot, pushEvent, startTicker],
  )

  const start = React.useCallback((meta?: TimedSessionMeta) => {
    if (statusRef.current === 'running' || statusRef.current === 'completed') return
    clearCompetingSnapshots()
    beginRunning('start', meta)
  }, [beginRunning, clearCompetingSnapshots])

  const pause = React.useCallback((meta?: TimedSessionMeta) => {
    if (statusRef.current !== 'running') return
    stopTicker()
    clearTimedSessionTimeout(autoPauseRef)
    autoPauseDeadlineAtRef.current = null
    pauseCountRef.current += 1
    setPauseCount(pauseCountRef.current)
    statusRef.current = 'paused'
    lastTickPersistAtRef.current = null
    setStatus('paused')
    setGlowState('paused')
    pushEvent('pause', meta)
    persistSnapshot()
    markDirty(timedSessionAutoSaveKey, 'pause')
  }, [persistSnapshot, pushEvent, stopTicker, timedSessionAutoSaveKey])

  const resume = React.useCallback((meta?: TimedSessionMeta) => {
    if (statusRef.current === 'completed') return
    if (statusRef.current === 'idle') {
      clearCompetingSnapshots()
      beginRunning('start', meta)
      return
    }
    if (statusRef.current === 'paused') {
      beginRunning('resume', meta)
    }
  }, [beginRunning, clearCompetingSnapshots])

  const persistRecordForUnload = React.useCallback(
    async (record: TimeSessionRecord | null) => {
      if (!record || !persistCompletionRecord) return record
      await fireAndQueueTimeRecordOnUnload(record)
      return record
    },
    [persistCompletionRecord],
  )

  const { leaveScene, leaveSceneForUnload } = useTimedSessionSceneLeave({
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
  })

  const setSceneActive = React.useCallback(
    (active: boolean, meta?: TimedSessionMeta) => {
      if (sceneActiveRef.current === active) {
        return
      }
      sceneActiveRef.current = active

      if (!active) {
        if (!startedAtRef.current || statusRef.current === 'completed') {
          return
        }
        const currentMs = Date.now()
        const { suspendedAt, resumeDeadlineAt } = buildSuspendedSceneLeaveState({
          currentMs,
          resumeWindowMs: resolvedAutomation.resumeWindowMs,
          meta,
        })
        stopTicker(currentMs)
        clearTimedSessionTimeout(autoPauseRef)
        autoPauseDeadlineAtRef.current = null
        clearTimedSessionTimeout(hiddenPauseRef)
        statusRef.current = 'paused'
        setStatus('paused')
        setGlowState('idle')
        idleSecondsRef.current = 0
        setIdleSeconds(0)
        closeActiveSceneSegment(suspendedAt)
        pushEvent('leave_scene', { source: 'scene_inactive', ...(meta ?? {}) }, { persist: false })
        suspendedAtRef.current = suspendedAt
        resumeDeadlineAtRef.current = resumeDeadlineAt
        leaveMetaRef.current = meta ?? null
        persistSnapshot({
          statusOverride: 'paused',
          suspended: true,
          suspendedAt,
          resumeDeadlineAt,
          leaveMeta: meta ?? null,
        })
        markDirty(timedSessionAutoSaveKey, 'scene_inactive')
        return
      }

      if (suspendedAtRef.current && resumeDeadlineAtRef.current) {
        resumeSuspendedScene(meta)
      }
    },
    [autoPauseRef, closeActiveSceneSegment, hiddenPauseRef, persistSnapshot, pushEvent, resolvedAutomation.resumeWindowMs, resumeSuspendedScene, stopTicker, timedSessionAutoSaveKey],
  )

  const { logEvent, registerActivity } = useTimedSessionActivityActions({
    armAutoPause,
    automationConfig,
    lastActivityAtRef,
    pushEvent,
    resume,
    sceneActiveRef,
    start,
    statusRef,
  })
  const {
    acknowledgeFocusGoal,
    acknowledgeFocusInterval,
    adjustDuration,
    startNextFocusRound,
  } = useTimedSessionFocusActions({
    autoSaveKey: timedSessionAutoSaveKey,
    durationEditedRef,
    effectiveSecondsRef,
    focusRoundRef,
    persistSnapshot,
    pushEvent,
    setDurationEdited,
    setEffectiveSeconds,
    setFocusRound,
  })
  const getEffectiveSeconds = React.useCallback(() => effectiveSecondsRef.current, [])

  const complete = React.useCallback(
    async (
      method: SessionCompletionMethod,
      meta?: TimedSessionMeta,
      completionOptions?: { persistRecord?: boolean },
    ) => {
      if (!startedAtRef.current) return null
      if (statusRef.current === 'completed') return null
      stopTicker()
      clearTimedSessionTimeout(autoPauseRef)
      autoPauseDeadlineAtRef.current = null
      clearTimedSessionTimeout(hiddenPauseRef)
      statusRef.current = 'completed'
      setStatus('completed')
      setGlowState('idle')
      clearSuspendedState()
      pushEvent(
        method === 'auto_complete'
          ? 'auto_complete'
          : method === 'manual_complete'
            ? 'manual_complete'
            : 'complete',
        meta,
      )

      const record = buildRecord(method)
      clearPersistedSnapshot()
      if (record) {
        removePendingTimeRecordRecovery(record.id)
      }
      if (!persistCompletionRecord || completionOptions?.persistRecord === false) {
        return record
      }
      return persistRecord(record)
    },
    [autoPauseRef, buildRecord, clearPersistedSnapshot, clearSuspendedState, hiddenPauseRef, persistCompletionRecord, persistRecord, pushEvent, stopTicker],
  )

  const reset = React.useCallback(() => {
    stopTicker()
    clearTimedSessionTimeout(autoPauseRef)
    autoPauseDeadlineAtRef.current = null
    clearTimedSessionTimeout(hiddenPauseRef)
    eventsRef.current = []
    sceneSegmentsRef.current = []
    activeSceneSegmentRef.current = null
    effectiveSecondsRef.current = 0
    lastTickPersistAtRef.current = null
    idleSecondsRef.current = 0
    pauseCountRef.current = 0
    startedAtRef.current = null
    lastActivityAtRef.current = null
    durationEditedRef.current = false
    focusRoundRef.current = { ...DEFAULT_TIMED_SESSION_FOCUS_ROUND }
    recordIdRef.current = null
    setEffectiveSeconds(0)
    setIdleSeconds(0)
    setPauseCount(0)
    setStartedAt(null)
    setDurationEdited(false)
    setFocusRound({ ...DEFAULT_TIMED_SESSION_FOCUS_ROUND })
    statusRef.current = 'idle'
    sceneActiveRef.current = true
    setStatus('idle')
    setGlowState('idle')
    clearSuspendedState()
    clearPersistedSnapshot()
  }, [autoPauseRef, clearPersistedSnapshot, clearSuspendedState, hiddenPauseRef, stopTicker])

  useTimedSessionSnapshotRestore({
    storageKey,
    restoredStorageKeyRef,
    recordIdRef,
    eventsRef,
    sceneSegmentsRef,
    activeSceneSegmentRef,
    focusRoundRef,
    effectiveSecondsRef,
    idleSecondsRef,
    pauseCountRef,
    startedAtRef,
    durationEditedRef,
    lastActivityAtRef,
    autoPauseDeadlineAtRef,
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
    setFocusRound,
    clearPersistedSnapshot,
    clearCompetingSnapshots,
    persistExpiredSuspendedSnapshot,
    persistSnapshot,
    resumeSuspendedScene,
    startTicker,
    armAutoPause,
  })

  useTimedSessionGlowReset(glowState, setGlowState)

  useTimedSessionBrowserPauseEffects({
    sceneActiveRef,
    statusRef,
    hiddenPauseRef,
    autoPauseRef,
    tickerRef,
    hiddenPauseMs: resolvedAutomation.hiddenPauseMs,
    pause,
    registerActivity,
    clearTimer: clearTimedSessionTimeout,
    clearIntervalTimer: clearTimedSessionInterval,
  })

  useTimedSessionUnloadPersistence(storageKey, leaveSceneForUnload)

  useTimedSessionAutomationConfigSubscription(setAutomationConfig)

  React.useEffect(() => {
    return registerAutoSaveTarget(timedSessionAutoSaveKey, {
      flush: async () => {
        await saveInProgressRecord()
      },
    })
  }, [saveInProgressRecord, timedSessionAutoSaveKey])

  return useStableTimedSessionController(buildTimedSessionController({
    sessionId: sessionIdRef.current,
    effectiveSeconds,
    idleSeconds,
    pauseCount,
    status,
    startedAt,
    durationEdited,
    glowState,
    focusRound,
    start,
    pause,
    resume,
    setSceneActive,
    leaveScene,
    registerActivity,
    logEvent,
    acknowledgeFocusInterval,
    acknowledgeFocusGoal,
    startNextFocusRound,
    adjustDuration,
    getEffectiveSeconds,
    complete,
    reset,
  }))
}
