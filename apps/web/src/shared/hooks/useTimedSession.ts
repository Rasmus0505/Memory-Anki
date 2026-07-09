import * as React from 'react'
import {
  removePendingTimeRecordRecovery,
  getWeeklyLocalSessionStats,
  persistStudySessionRecord,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type TimeSessionRecord,
  upsertPendingTimeRecordRecovery,
} from '@/entities/session/model'
import {
  getTimerAutomationRule,
  isActivityEnabled,
  readTimerAutomationConfig,
  type TimerAutomationActivityKind,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { formatLocalApiDateTime } from '@/shared/lib/dateTime'
import { detectClientSource } from '@/shared/lib/clientSource'
import {
  AUTO_PAUSE_MS,
  HIDDEN_PAUSE_MS,
  buildTimedSessionController,
  createStableRecordId,
  nowIso,
  resolveTimedSessionAutomation,
  type ActiveSceneSegmentSnapshot,
  type GlowState,
  type PersistedSessionStatus,
  type RestorableTimedSessionSnapshot,
  type SessionSceneSegment,
  type SessionStatus,
  type TimedSessionController,
  type TimedSessionMeta,
  type TimedSessionOptions,
} from './timedSessionModel'
import {
  buildTimedSessionStorageKey,
  clearCompetingTimedSessionSnapshots,
  clearPersistedTimedSessionSnapshot,
} from './timedSessionStorage'
import {
  buildPersistedTimedSessionSnapshot,
  buildRestorableTimedSessionSnapshot,
  buildRecordFromExpiredSuspendedSnapshot,
  writePersistedTimedSessionSnapshot,
} from './timedSessionSnapshot'
import { markDirty, registerAutoSaveTarget } from '@/shared/persistence/autosaveCoordinator'
import {
  clearTimedSessionInterval,
  clearTimedSessionTimeout,
  useTimedSessionAutomationConfigSubscription,
  useTimedSessionBrowserPauseEffects,
  useTimedSessionGlowReset,
  useTimedSessionUnloadPersistence,
} from './timedSessionBrowserEffects'
import { fireAndQueueTimeRecordOnUnload } from './timedSessionRecovery'
import { useTimedSessionSnapshotRestore } from './timedSessionRestore'

export type { TimedSessionController, TimedSessionOptions } from './timedSessionModel'

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
}: TimedSessionOptions): TimedSessionController {
  const sessionScene = automationScene
  const sessionIdRef = React.useRef(createStableRecordId())
  const [effectiveSeconds, setEffectiveSeconds] = React.useState(0)
  const [idleSeconds, setIdleSeconds] = React.useState(0)
  const [pauseCount, setPauseCount] = React.useState(0)
  const [status, setStatus] = React.useState<SessionStatus>('idle')
  const [startedAt, setStartedAt] = React.useState<string | null>(null)
  const [durationEdited, setDurationEdited] = React.useState(false)
  const [glowState, setGlowState] = React.useState<GlowState>('idle')

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
  const hiddenPauseRef = React.useRef<number | null>(null)
  const restoredStorageKeyRef = React.useRef<string | null>(null)
  const leaveHandledRef = React.useRef(false)
  const sceneActiveRef = React.useRef(true)
  const suspendedAtRef = React.useRef<string | null>(null)
  const resumeDeadlineAtRef = React.useRef<string | null>(null)
  const leaveMetaRef = React.useRef<TimedSessionMeta | null>(null)
  const sceneSegmentsRef = React.useRef<SessionSceneSegment[]>([])
  const activeSceneSegmentRef = React.useRef<ActiveSceneSegmentSnapshot | null>(null)
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

  const buildActiveSceneSegment = React.useCallback((): ActiveSceneSegmentSnapshot => ({
    scene: sessionScene,
    kind,
    palaceId,
    sourceKind,
    englishCourseId,
    title,
    startedAt: nowIso(),
    startEffectiveSeconds: effectiveSecondsRef.current,
  }), [englishCourseId, kind, palaceId, sessionScene, sourceKind, title])

  const maybeStartSceneSegment = React.useCallback(() => {
    if (activeSceneSegmentRef.current) return
    activeSceneSegmentRef.current = buildActiveSceneSegment()
  }, [buildActiveSceneSegment])

  const closeActiveSceneSegment = React.useCallback((endedAt = nowIso()) => {
    const activeSegment = activeSceneSegmentRef.current
    if (!activeSegment) return
    const effectiveSegmentSeconds = Math.max(
      0,
      Math.round(effectiveSecondsRef.current - activeSegment.startEffectiveSeconds),
    )
    if (effectiveSegmentSeconds > 0) {
      sceneSegmentsRef.current.push({
        scene: activeSegment.scene,
        kind: activeSegment.kind,
        palaceId: activeSegment.palaceId,
        sourceKind: activeSegment.sourceKind,
        englishCourseId: activeSegment.englishCourseId,
        title: activeSegment.title,
        startedAt: activeSegment.startedAt,
        endedAt,
        effectiveSeconds: effectiveSegmentSeconds,
      })
    }
    activeSceneSegmentRef.current = null
  }, [])

  const ensureRecordId = React.useCallback(() => {
    if (!recordIdRef.current) {
      recordIdRef.current = createStableRecordId()
    }
    return recordIdRef.current
  }, [])

  const getIdleSecondsAt = React.useCallback((currentMs: number) => {
    if (lastActivityAtRef.current == null) return 0
    return Math.max(0, Math.floor((currentMs - lastActivityAtRef.current) / 1000))
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
    const elapsedMs = Math.max(0, currentMs - lastTickAtRef.current)
    const diffSeconds = Math.floor(elapsedMs / 1000)
    let changed = false
    if (diffSeconds > 0) {
      effectiveSecondsRef.current += diffSeconds
      setEffectiveSeconds(effectiveSecondsRef.current)
      lastTickAtRef.current += diffSeconds * 1000
      changed = true
    } else if (elapsedMs > 0 && elapsedMs < 1000) {
      lastTickAtRef.current = currentMs - elapsedMs
    }
    const nextIdle = getIdleSecondsAt(currentMs)
    if (nextIdle !== idleSecondsRef.current) {
      idleSecondsRef.current = nextIdle
      setIdleSeconds(nextIdle)
      changed = true
    }
    if (changed && (lastTickPersistAtRef.current == null || currentMs - lastTickPersistAtRef.current >= 5_000)) {
      lastTickPersistAtRef.current = currentMs
      persistSnapshot()
      markDirty(timedSessionAutoSaveKey, 'tick')
    }
  }, [getIdleSecondsAt, persistSnapshot, timedSessionAutoSaveKey])

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
    return {
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
      clientSource: detectClientSource(),
      events: [...eventsRef.current],
      sceneSegments: [...sceneSegmentsRef.current],
    }
  }, [closeActiveSceneSegment, englishCourseId, ensureRecordId, kind, palaceId, sourceKind, title])

  const persistRecord = React.useCallback(async (
    record: TimeSessionRecord | null,
  ) => {
    if (!record) return null
    try {
      const persisted = await persistStudySessionRecord(record)
      removePendingTimeRecordRecovery(record.id)
      return persisted
    } catch {
      upsertPendingTimeRecordRecovery(record, {
        status: 'failed',
        lastError: '保存时间记录失败，已等待下次恢复',
      })
      return record
    }
  }, [])

  const saveInProgressRecord = React.useCallback(async () => {
    if (!startedAtRef.current || statusRef.current === 'completed') {
      return
    }
    const record = buildRecord('saved', nowIso())
    if (!record) {
      return
    }
    await persistRecord(record)
  }, [buildRecord, persistRecord])

  const persistExpiredSuspendedSnapshot = React.useCallback(async (
    snapshot: RestorableTimedSessionSnapshot,
  ) => {
    return persistRecord(buildRecordFromExpiredSuspendedSnapshot(snapshot))
  }, [persistRecord])

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

  const armAutoPause = React.useCallback(() => {
    clearTimedSessionTimeout(autoPauseRef)
    if (statusRef.current !== 'running') return
    autoPauseRef.current = window.setTimeout(() => {
      if (statusRef.current !== 'running') return
      const pausedAtMs = Date.now()
      const idleSecondsAtPause = getIdleSecondsAt(pausedAtMs)
      const rollbackSeconds = Math.min(
        resolvedAutomation.autoPauseRollbackSeconds,
        idleSecondsAtPause,
      )
      autoPauseRef.current = null
      stopTicker(pausedAtMs)
      pauseCountRef.current += 1
      setPauseCount(pauseCountRef.current)
      statusRef.current = 'paused'
      setStatus('paused')
      setGlowState('paused')
      effectiveSecondsRef.current = Math.max(
        0,
        effectiveSecondsRef.current - rollbackSeconds,
      )
      setEffectiveSeconds(effectiveSecondsRef.current)
      idleSecondsRef.current = 0
      setIdleSeconds(0)
      pushEvent('pause', {
        reason: 'inactive',
        idle_seconds: idleSecondsAtPause,
        rollback_seconds: rollbackSeconds,
      })
      persistSnapshot()
      markDirty(timedSessionAutoSaveKey, 'auto_pause')
    }, resolvedAutomation.autoPauseMs)
  }, [getIdleSecondsAt, persistSnapshot, pushEvent, resolvedAutomation, stopTicker, timedSessionAutoSaveKey])

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

  const leaveScene = React.useCallback(
    async (meta?: TimedSessionMeta) => {
      if (!startedAtRef.current || statusRef.current === 'completed' || leaveHandledRef.current) {
        return null
      }
      leaveHandledRef.current = true
      const currentMs = Date.now()
      const suspendedAt = nowIso()
      const resumeDeadlineAt = formatLocalApiDateTime(
        new Date(currentMs + resolvedAutomation.resumeWindowMs),
      )
      const persistedLeaveMeta = {
        ...(meta ?? {}),
        persisted_record: true,
      }
      stopTicker(currentMs)
      clearTimedSessionTimeout(autoPauseRef)
      clearTimedSessionTimeout(hiddenPauseRef)
      statusRef.current = 'paused'
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
      return persistRecord(record)
    },
    [
      autoPauseRef,
      buildRecord,
      closeActiveSceneSegment,
      hiddenPauseRef,
      persistRecord,
      persistSnapshot,
      pushEvent,
      resolvedAutomation.resumeWindowMs,
      stopTicker,
    ],
  )

  const persistRecordForUnload = React.useCallback(
    async (record: TimeSessionRecord | null) => {
      if (!record) return null
      await fireAndQueueTimeRecordOnUnload(record)
      return record
    },
    [],
  )

  const leaveSceneForUnload = React.useCallback(async (meta?: TimedSessionMeta) => {
    if (!startedAtRef.current || statusRef.current === 'completed' || leaveHandledRef.current) {
      return null
    }
    leaveHandledRef.current = true
    const currentMs = Date.now()
    const suspendedAt = nowIso()
    const resumeDeadlineAt = formatLocalApiDateTime(
      new Date(currentMs + resolvedAutomation.resumeWindowMs),
    )
    const persistedLeaveMeta = {
      ...(meta ?? {}),
      persisted_record: true,
      unload_persisted: true,
    }
    stopTicker(currentMs)
    clearTimedSessionTimeout(autoPauseRef)
    clearTimedSessionTimeout(hiddenPauseRef)
    statusRef.current = 'paused'
    lastTickPersistAtRef.current = null
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
    return persistRecordForUnload(record)
  }, [
    autoPauseRef,
    buildRecord,
    closeActiveSceneSegment,
    hiddenPauseRef,
    persistRecordForUnload,
    persistSnapshot,
    pushEvent,
    resolvedAutomation.resumeWindowMs,
    stopTicker,
  ])

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
        const suspendedAt = nowIso()
        const resumeDeadlineAt = formatLocalApiDateTime(
          new Date(currentMs + resolvedAutomation.resumeWindowMs),
        )
        stopTicker(currentMs)
        clearTimedSessionTimeout(autoPauseRef)
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

  const registerActivity = React.useCallback((
    activityKind: TimerAutomationActivityKind,
    meta?: TimedSessionMeta,
  ) => {
    if (!sceneActiveRef.current) {
      return
    }
    if (!isActivityEnabled(activityKind, automationConfig)) {
      return
    }
    if (statusRef.current === 'idle') {
      start({ source: 'auto', ...(meta ?? {}) })
      return
    }
    if (statusRef.current === 'paused') {
      resume({ source: 'auto', ...(meta ?? {}) })
      return
    }
    if (statusRef.current === 'running') {
      lastActivityAtRef.current = Date.now()
      armAutoPause()
    }
  }, [armAutoPause, automationConfig, resume, start])

  const logEvent = React.useCallback((type: SessionEventRecord['type'], meta?: TimedSessionMeta) => {
    pushEvent(type, meta)
  }, [pushEvent])

  const adjustDuration = React.useCallback((seconds: number) => {
    effectiveSecondsRef.current = Math.max(0, Math.round(seconds))
    setEffectiveSeconds(effectiveSecondsRef.current)
    setDurationEdited(true)
    durationEditedRef.current = true
    pushEvent('adjust_duration', { seconds: effectiveSecondsRef.current })
    persistSnapshot()
    markDirty(timedSessionAutoSaveKey, 'adjust_duration')
  }, [persistSnapshot, pushEvent, timedSessionAutoSaveKey])

  const complete = React.useCallback(
    async (
      method: SessionCompletionMethod,
      meta?: TimedSessionMeta,
    ) => {
      if (!startedAtRef.current) return null
      if (statusRef.current === 'completed') return null
      stopTicker()
      clearTimedSessionTimeout(autoPauseRef)
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
      if (!persistCompletionRecord) {
        return record
      }
      return persistRecord(record)
    },
    [autoPauseRef, buildRecord, clearPersistedSnapshot, clearSuspendedState, hiddenPauseRef, persistCompletionRecord, persistRecord, pushEvent, stopTicker],
  )

  const reset = React.useCallback(() => {
    stopTicker()
    clearTimedSessionTimeout(autoPauseRef)
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
    recordIdRef.current = null
    setEffectiveSeconds(0)
    setIdleSeconds(0)
    setPauseCount(0)
    setStartedAt(null)
    setDurationEdited(false)
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

  return buildTimedSessionController({
    sessionId: sessionIdRef.current,
    effectiveSeconds,
    idleSeconds,
    pauseCount,
    status,
    startedAt,
    durationEdited,
    glowState,
    start,
    pause,
    resume,
    setSceneActive,
    leaveScene,
    registerActivity,
    logEvent,
    adjustDuration,
    complete,
    reset,
  })
}

export { getWeeklyLocalSessionStats }
export { shouldAutoStartOnPageEnter } from '@/shared/components/session/timer-automation-config'
