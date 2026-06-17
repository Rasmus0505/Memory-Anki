import * as React from 'react'
import {
  appendTimeRecord,
  getWeeklyLocalSessionStats,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type TimeSessionRecord,
} from '@/entities/session/model'
import {
  getTimerAutomationRule,
  isActivityEnabled,
  readTimerAutomationConfig,
  type TimerAutomationActivityKind,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { formatLocalApiDateTime } from '@/shared/lib/dateTime'
import {
  AUTO_PAUSE_MS,
  HIDDEN_PAUSE_MS,
  createStableRecordId,
  normalizeSnapshot,
  nowIso,
  resolveTimedSessionAutomation,
  SNAPSHOT_VERSION,
  SNAPSHOT_STORAGE_PREFIX,
  type ActiveSceneSegmentSnapshot,
  type GlowState,
  type LegacyPersistedTimedSessionSnapshot,
  type PersistedSessionStatus,
  type PersistedTimedSessionSnapshotV2,
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
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )

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
      const snapshot: PersistedTimedSessionSnapshotV2 = {
        version: SNAPSHOT_VERSION,
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
        persistedAt: nowIso(),
        suspended: options?.suspended ?? false,
        suspendedAt: options?.suspendedAt ?? null,
        resumeDeadlineAt: options?.resumeDeadlineAt ?? null,
        leaveMeta: options?.leaveMeta ?? null,
        sceneSegments: [...sceneSegmentsRef.current],
        activeSceneSegment: activeSceneSegmentRef.current,
      }
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot))
      } catch {
        // Ignore storage errors in private mode or restricted environments.
      }
    },
    [clearPersistedSnapshot, englishCourseId, kind, palaceId, sourceKind, storageKey, title],
  )

  const clearTimer = React.useCallback((ref: React.MutableRefObject<number | null>) => {
    if (ref.current != null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }, [])

  const clearIntervalTimer = React.useCallback((ref: React.MutableRefObject<number | null>) => {
    if (ref.current != null) {
      window.clearInterval(ref.current)
      ref.current = null
    }
  }, [])

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
    if (diffSeconds > 0) {
      effectiveSecondsRef.current += diffSeconds
      setEffectiveSeconds(effectiveSecondsRef.current)
      lastTickAtRef.current += diffSeconds * 1000
    } else if (elapsedMs > 0 && elapsedMs < 1000) {
      lastTickAtRef.current = currentMs - elapsedMs
    }
    const nextIdle = getIdleSecondsAt(currentMs)
    if (nextIdle !== idleSecondsRef.current) {
      idleSecondsRef.current = nextIdle
      setIdleSeconds(nextIdle)
    }
    persistSnapshot()
  }, [getIdleSecondsAt, persistSnapshot])

  const startTicker = React.useCallback(() => {
    clearIntervalTimer(tickerRef)
    lastTickAtRef.current = Date.now()
    tickerRef.current = window.setInterval(() => {
      syncTick()
    }, 250)
  }, [clearIntervalTimer, syncTick])

  const stopTicker = React.useCallback((currentMs?: number) => {
    syncTick(currentMs)
    clearIntervalTimer(tickerRef)
    lastTickAtRef.current = null
  }, [clearIntervalTimer, syncTick])

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
      events: [...eventsRef.current],
      sceneSegments: [...sceneSegmentsRef.current],
    }
  }, [closeActiveSceneSegment, englishCourseId, ensureRecordId, kind, palaceId, sourceKind, title])

  const persistRecord = React.useCallback(async (
    record: TimeSessionRecord | null,
  ) => {
    if (!record) return null
    try {
      return await appendTimeRecord(record)
    } catch {
      return record
    }
  }, [])

  const persistExpiredSuspendedSnapshot = React.useCallback(async (
    snapshot: RestorableTimedSessionSnapshot,
  ) => {
    if (!snapshot.startedAt) return null
    if (snapshot.leaveMeta?.persisted_record === true) return null
    const endedAt = snapshot.suspendedAt ?? snapshot.persistedAt ?? nowIso()
    const sceneSegments = [...snapshot.sceneSegments]
    const activeSegment = snapshot.activeSceneSegment
    if (activeSegment) {
      const effectiveSegmentSeconds = Math.max(
        0,
        Math.round(snapshot.effectiveSeconds - activeSegment.startEffectiveSeconds),
      )
      if (effectiveSegmentSeconds > 0) {
        sceneSegments.push({
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
    }
    return persistRecord({
      id: snapshot.recordId ?? createStableRecordId(),
      kind: snapshot.kind,
      palaceId: snapshot.palaceId,
      sourceKind: snapshot.sourceKind,
      englishCourseId: snapshot.englishCourseId,
      title: snapshot.title,
      startedAt: snapshot.startedAt,
      endedAt,
      effectiveSeconds: snapshot.effectiveSeconds,
      pauseCount: snapshot.pauseCount,
      completionMethod: 'left_page',
      durationEdited: snapshot.durationEdited,
      events: [...snapshot.events],
      sceneSegments,
    })
  }, [persistRecord])

  const finalizeExpiredSuspendedState = React.useCallback(() => {
    const pendingSnapshot: RestorableTimedSessionSnapshot | null =
      startedAtRef.current && suspendedAtRef.current
        ? {
            version: SNAPSHOT_VERSION,
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
            persistedAt: nowIso(),
            suspended: true,
            suspendedAt: suspendedAtRef.current,
            resumeDeadlineAt: resumeDeadlineAtRef.current,
            leaveMeta: leaveMetaRef.current,
            sceneSegments: [...sceneSegmentsRef.current],
            activeSceneSegment: activeSceneSegmentRef.current,
          }
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
    clearTimer(autoPauseRef)
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
    }, resolvedAutomation.autoPauseMs)
  }, [clearTimer, getIdleSecondsAt, persistSnapshot, pushEvent, resolvedAutomation, stopTicker])

  const beginRunning = React.useCallback((eventType: 'start' | 'resume', meta?: TimedSessionMeta) => {
    const nextStartedAt = startedAtRef.current ?? nowIso()
    sceneActiveRef.current = true
    setStartedAt(nextStartedAt)
    startedAtRef.current = nextStartedAt
    ensureRecordId()
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
    pushEvent(eventType, meta)
    persistSnapshot()
  }, [armAutoPause, clearSuspendedState, ensureRecordId, maybeStartSceneSegment, persistSnapshot, pushEvent, startTicker])

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
    clearTimer(autoPauseRef)
    pauseCountRef.current += 1
    setPauseCount(pauseCountRef.current)
    statusRef.current = 'paused'
    setStatus('paused')
    setGlowState('paused')
    pushEvent('pause', meta)
    persistSnapshot()
  }, [clearTimer, persistSnapshot, pushEvent, stopTicker])

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
      clearTimer(autoPauseRef)
      clearTimer(hiddenPauseRef)
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
      clearTimer,
      hiddenPauseRef,
      persistRecord,
      persistSnapshot,
      pushEvent,
      resolvedAutomation.resumeWindowMs,
      stopTicker,
    ],
  )

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
        clearTimer(autoPauseRef)
        clearTimer(hiddenPauseRef)
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
        return
      }

      if (suspendedAtRef.current && resumeDeadlineAtRef.current) {
        resumeSuspendedScene(meta)
      }
    },
    [autoPauseRef, clearTimer, closeActiveSceneSegment, hiddenPauseRef, persistSnapshot, pushEvent, resolvedAutomation.resumeWindowMs, resumeSuspendedScene, stopTicker],
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
  }, [persistSnapshot, pushEvent])

  const complete = React.useCallback(
    async (
      method: SessionCompletionMethod,
      meta?: TimedSessionMeta,
    ) => {
      if (!startedAtRef.current) return null
      if (statusRef.current === 'completed') return null
      stopTicker()
      clearTimer(autoPauseRef)
      clearTimer(hiddenPauseRef)
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
      if (!persistCompletionRecord) {
        return record
      }
      return persistRecord(record)
    },
    [autoPauseRef, buildRecord, clearPersistedSnapshot, clearSuspendedState, clearTimer, hiddenPauseRef, persistCompletionRecord, persistRecord, pushEvent, stopTicker],
  )

  const reset = React.useCallback(() => {
    stopTicker()
    clearTimer(autoPauseRef)
    clearTimer(hiddenPauseRef)
    eventsRef.current = []
    sceneSegmentsRef.current = []
    activeSceneSegmentRef.current = null
    effectiveSecondsRef.current = 0
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
  }, [autoPauseRef, clearPersistedSnapshot, clearSuspendedState, clearTimer, hiddenPauseRef, stopTicker])

  React.useEffect(() => {
    if (!storageKey || restoredStorageKeyRef.current === storageKey) return
    restoredStorageKeyRef.current = storageKey
    let parsed: RestorableTimedSessionSnapshot | null
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      parsed = normalizeSnapshot(raw ? JSON.parse(raw) as PersistedTimedSessionSnapshotV2 | LegacyPersistedTimedSessionSnapshot : null)
      if (!parsed) {
        for (let index = 0; index < window.sessionStorage.length; index += 1) {
          const candidateKey = window.sessionStorage.key(index)
          if (!candidateKey || !candidateKey.startsWith(SNAPSHOT_STORAGE_PREFIX) || candidateKey === storageKey) {
            continue
          }
          const candidateRaw = window.sessionStorage.getItem(candidateKey)
          const candidate = normalizeSnapshot(
            candidateRaw ? JSON.parse(candidateRaw) as PersistedTimedSessionSnapshotV2 | LegacyPersistedTimedSessionSnapshot : null,
          )
          if (!candidate?.suspended) {
            continue
          }
          const candidateAt = new Date(candidate.persistedAt).getTime()
          const parsedAt = parsed ? new Date(parsed.persistedAt).getTime() : Number.NEGATIVE_INFINITY
          if (!parsed || candidateAt > parsedAt) {
            parsed = candidate
          }
        }
      }
    } catch {
      parsed = null
    }
    if (!parsed) {
      clearPersistedSnapshot()
      return
    }
    if (!parsed.startedAt) {
      clearPersistedSnapshot()
      return
    }

    if (parsed.suspended) {
      const deadlineMs = parsed.resumeDeadlineAt ? new Date(parsed.resumeDeadlineAt).getTime() : Number.NaN
      if (!Number.isFinite(deadlineMs) || Date.now() > deadlineMs) {
        void persistExpiredSuspendedSnapshot(parsed)
        clearPersistedSnapshot()
        return
      }
    }

    const persistedAtMs = new Date(parsed.persistedAt).getTime()
    const restoreNowMs = Date.now()
    const elapsedSincePersistSeconds =
      !parsed.suspended && parsed.status === 'running' && Number.isFinite(persistedAtMs)
        ? Math.max(0, Math.floor((restoreNowMs - persistedAtMs) / 1000))
        : 0
    const restoredEffectiveSeconds = Math.max(
      0,
      Math.round(parsed.effectiveSeconds + elapsedSincePersistSeconds),
    )

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
  }, [armAutoPause, clearCompetingSnapshots, clearPersistedSnapshot, clearSuspendedState, resumeSuspendedScene, englishCourseId, kind, palaceId, persistSnapshot, sourceKind, startTicker, storageKey])

  React.useEffect(() => {
    if (glowState === 'idle') return
    const timer = window.setTimeout(() => setGlowState('idle'), 1000)
    return () => window.clearTimeout(timer)
  }, [glowState])

  React.useEffect(() => {
    const handleVisibility = () => {
      if (!sceneActiveRef.current) {
        clearTimer(hiddenPauseRef)
        return
      }
      if (document.visibilityState === 'hidden') {
        clearTimer(hiddenPauseRef)
        hiddenPauseRef.current = window.setTimeout(() => {
          pause({ reason: 'hidden' })
        }, resolvedAutomation.hiddenPauseMs)
        return
      }
      clearTimer(hiddenPauseRef)
      if (statusRef.current === 'paused') {
        registerActivity('window_return', { reason: 'visible' })
      }
    }

    const handleBlur = () => {
      if (!sceneActiveRef.current) {
        clearTimer(hiddenPauseRef)
        return
      }
      clearTimer(hiddenPauseRef)
      hiddenPauseRef.current = window.setTimeout(() => {
        pause({ reason: 'blur' })
      }, resolvedAutomation.hiddenPauseMs)
    }

    const handleFocus = () => {
      clearTimer(hiddenPauseRef)
      if (!sceneActiveRef.current) {
        return
      }
      if (statusRef.current === 'paused') {
        registerActivity('window_return', { reason: 'focus' })
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      clearTimer(hiddenPauseRef)
      clearTimer(autoPauseRef)
      clearIntervalTimer(tickerRef)
    }
  }, [autoPauseRef, clearIntervalTimer, clearTimer, pause, registerActivity, resolvedAutomation.hiddenPauseMs])

  React.useEffect(() => {
    if (!storageKey) return
    const handlePersistOnUnload = () => {
      void leaveScene({ source: 'page_unload' })
    }
    window.addEventListener('beforeunload', handlePersistOnUnload)
    window.addEventListener('pagehide', handlePersistOnUnload)
    return () => {
      window.removeEventListener('beforeunload', handlePersistOnUnload)
      window.removeEventListener('pagehide', handlePersistOnUnload)
    }
  }, [leaveScene, storageKey])

  React.useEffect(() => {
    const handleAutomationChange = (event: Event) => {
      const nextConfig =
        event instanceof CustomEvent && event.detail
          ? (event.detail as TimerAutomationConfig)
          : readTimerAutomationConfig()
      setAutomationConfig(nextConfig)
    }

    window.addEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    return () => {
      window.removeEventListener('memory-anki-timer-automation-change', handleAutomationChange)
    }
  }, [])

  return {
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
  }
}

export { getWeeklyLocalSessionStats }
export { shouldAutoStartOnPageEnter } from '@/shared/components/session/timer-automation-config'
