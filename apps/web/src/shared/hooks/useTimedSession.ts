import * as React from 'react'
import {
  appendTimeRecord,
  getWeeklyLocalSessionStats,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type SessionKind,
  type TimeSessionRecord,
} from '@/entities/session/model'
import {
  getTimerAutomationRule,
  isActivityEnabled,
  readTimerAutomationConfig,
  type TimerAutomationActivityKind,
  type TimerAutomationConfig,
  type TimerAutomationScene,
} from '@/shared/components/session/timer-automation-config'
import { formatLocalApiDateTime } from '@/shared/lib/dateTime'

const AUTO_PAUSE_MS = 2 * 60 * 1000
const HIDDEN_PAUSE_MS = 15 * 1000
const SNAPSHOT_STORAGE_PREFIX = 'memory-anki-timed-session:'
const SNAPSHOT_VERSION = 2

export interface TimedSessionOptions {
  kind: SessionKind
  title: string
  palaceId: number | null
  automationScene?: TimerAutomationScene
  sourceKind?: 'palace' | 'english' | 'english_reading' | null
  englishCourseId?: number | null
  autoPauseMs?: number
  hiddenPauseMs?: number
  persistKey?: string | null
  persistCompletionRecord?: boolean
}

type SessionStatus = 'idle' | 'running' | 'paused' | 'completed'
type GlowState = 'idle' | 'running' | 'paused'
type PersistedSessionStatus = Extract<SessionStatus, 'running' | 'paused'>

export interface TimedSessionController {
  effectiveSeconds: number
  idleSeconds: number
  pauseCount: number
  status: SessionStatus
  startedAt: string | null
  durationEdited: boolean
  glowState: GlowState
  start: (meta?: Record<string, boolean | number | string | null>) => void
  pause: (meta?: Record<string, boolean | number | string | null>) => void
  resume: (meta?: Record<string, boolean | number | string | null>) => void
  leaveScene: (meta?: Record<string, boolean | number | string | null>) => Promise<TimeSessionRecord | null>
  registerActivity: (
    activityKind: TimerAutomationActivityKind,
    meta?: Record<string, boolean | number | string | null>,
  ) => void
  logEvent: (type: SessionEventRecord['type'], meta?: Record<string, boolean | number | string | null>) => void
  adjustDuration: (seconds: number) => void
  complete: (
    method: SessionCompletionMethod,
    meta?: Record<string, boolean | number | string | null>,
  ) => Promise<TimeSessionRecord | null>
  reset: () => void
}

interface PersistedTimedSessionSnapshotV2 {
  version: 2
  recordId: string | null
  kind: SessionKind
  palaceId: number | null
  sourceKind: 'palace' | 'english' | 'english_reading' | null
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: PersistedSessionStatus
  startedAt: string | null
  durationEdited: boolean
  events: SessionEventRecord[]
  persistedAt: string
  suspended: boolean
  suspendedAt: string | null
  resumeDeadlineAt: string | null
  leaveMeta: Record<string, boolean | number | string | null> | null
}

interface LegacyPersistedTimedSessionSnapshot {
  version: 1
  kind: SessionKind
  palaceId: number | null
  sourceKind: 'palace' | 'english' | 'english_reading' | null
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: SessionStatus
  startedAt: string | null
  durationEdited: boolean
  events: SessionEventRecord[]
  persistedAt: string
}

interface RestorableTimedSessionSnapshot {
  version: 2
  recordId: string | null
  kind: SessionKind
  palaceId: number | null
  sourceKind: 'palace' | 'english' | 'english_reading' | null
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: PersistedSessionStatus
  startedAt: string | null
  durationEdited: boolean
  events: SessionEventRecord[]
  persistedAt: string
  suspended: boolean
  suspendedAt: string | null
  resumeDeadlineAt: string | null
  leaveMeta: Record<string, boolean | number | string | null> | null
}

interface ResolvedTimedSessionAutomation {
  autoPauseMs: number
  hiddenPauseMs: number
  resumeWindowMs: number
  autoPauseRollbackSeconds: number
}

function nowIso() {
  return formatLocalApiDateTime(new Date())
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createStableRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return randomId()
}

function normalizeSnapshot(
  value: unknown,
): RestorableTimedSessionSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.version === 1) {
    const status = raw.status
    if (status !== 'running' && status !== 'paused') {
      return null
    }
    return {
      version: 2,
      recordId: null,
      kind: raw.kind as SessionKind,
      palaceId: typeof raw.palaceId === 'number' ? raw.palaceId : null,
      sourceKind:
        raw.sourceKind === 'palace' ||
        raw.sourceKind === 'english' ||
        raw.sourceKind === 'english_reading'
          ? raw.sourceKind
          : null,
      englishCourseId: typeof raw.englishCourseId === 'number' ? raw.englishCourseId : null,
      title: typeof raw.title === 'string' ? raw.title : '',
      effectiveSeconds: Math.max(0, Math.round(Number(raw.effectiveSeconds) || 0)),
      pauseCount: Math.max(0, Math.round(Number(raw.pauseCount) || 0)),
      status,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
      durationEdited: Boolean(raw.durationEdited),
      events: Array.isArray(raw.events) ? (raw.events as SessionEventRecord[]) : [],
      persistedAt: typeof raw.persistedAt === 'string' ? raw.persistedAt : nowIso(),
      suspended: false,
      suspendedAt: null,
      resumeDeadlineAt: null,
      leaveMeta: null,
    }
  }

  if (raw.version !== SNAPSHOT_VERSION) {
    return null
  }

  const status = raw.status
  if (status !== 'running' && status !== 'paused') {
    return null
  }

  return {
    version: 2,
    recordId: typeof raw.recordId === 'string' && raw.recordId ? raw.recordId : null,
    kind: raw.kind as SessionKind,
    palaceId: typeof raw.palaceId === 'number' ? raw.palaceId : null,
    sourceKind:
      raw.sourceKind === 'palace' ||
      raw.sourceKind === 'english' ||
      raw.sourceKind === 'english_reading'
        ? raw.sourceKind
        : null,
    englishCourseId: typeof raw.englishCourseId === 'number' ? raw.englishCourseId : null,
    title: typeof raw.title === 'string' ? raw.title : '',
    effectiveSeconds: Math.max(0, Math.round(Number(raw.effectiveSeconds) || 0)),
    pauseCount: Math.max(0, Math.round(Number(raw.pauseCount) || 0)),
    status,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    durationEdited: Boolean(raw.durationEdited),
    events: Array.isArray(raw.events) ? (raw.events as SessionEventRecord[]) : [],
    persistedAt: typeof raw.persistedAt === 'string' ? raw.persistedAt : nowIso(),
    suspended: Boolean(raw.suspended),
    suspendedAt: typeof raw.suspendedAt === 'string' ? raw.suspendedAt : null,
    resumeDeadlineAt: typeof raw.resumeDeadlineAt === 'string' ? raw.resumeDeadlineAt : null,
    leaveMeta:
      raw.leaveMeta && typeof raw.leaveMeta === 'object'
        ? (raw.leaveMeta as Record<string, boolean | number | string | null>)
        : null,
  }
}

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
  const suspendedAtRef = React.useRef<string | null>(null)
  const resumeDeadlineAtRef = React.useRef<string | null>(null)
  const leaveMetaRef =
    React.useRef<Record<string, boolean | number | string | null> | null>(null)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )

  const resolvedAutomation = React.useMemo<ResolvedTimedSessionAutomation>(() => {
    const sceneRule = getTimerAutomationRule(automationScene, automationConfig)
    const resolvedInactiveMs = Math.max(
      0,
      Math.round(autoPauseMs ?? sceneRule.inactiveAutoPauseSeconds * 1000),
    )
    return {
      autoPauseMs: resolvedInactiveMs,
      hiddenPauseMs: Math.max(0, Math.round(hiddenPauseMs ?? sceneRule.hiddenAutoPauseSeconds * 1000)),
      resumeWindowMs: resolvedInactiveMs,
      autoPauseRollbackSeconds: Math.max(
        0,
        Math.min(
          Math.round(sceneRule.autoPauseRollbackSeconds),
          Math.round(sceneRule.inactiveAutoPauseSeconds),
        ),
      ),
    }
  }, [autoPauseMs, automationConfig, automationScene, hiddenPauseMs])

  const storageKey = React.useMemo(
    () => (persistKey ? `${SNAPSHOT_STORAGE_PREFIX}${persistKey}` : null),
    [persistKey],
  )

  const clearPersistedSnapshot = React.useCallback(() => {
    if (!storageKey) return
    try {
      window.sessionStorage.removeItem(storageKey)
    } catch {
      // Ignore storage errors in private mode or restricted environments.
    }
  }, [storageKey])

  const clearCompetingSnapshots = React.useCallback(() => {
    if (!storageKey) return
    try {
      for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = window.sessionStorage.key(index)
        if (!key || !key.startsWith(SNAPSHOT_STORAGE_PREFIX) || key === storageKey) {
          continue
        }
        window.sessionStorage.removeItem(key)
      }
    } catch {
      // Ignore storage errors in private mode or restricted environments.
    }
  }, [storageKey])

  const persistSnapshot = React.useCallback(
    (options?: {
      statusOverride?: PersistedSessionStatus
      suspended?: boolean
      suspendedAt?: string | null
      resumeDeadlineAt?: string | null
      leaveMeta?: Record<string, boolean | number | string | null> | null
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
    meta?: Record<string, boolean | number | string | null>,
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
    }
  }, [englishCourseId, ensureRecordId, kind, palaceId, sourceKind, title])

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

  const beginRunning = React.useCallback((eventType: 'start' | 'resume', meta?: Record<string, boolean | number | string | null>) => {
    const nextStartedAt = startedAtRef.current ?? nowIso()
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
    startTicker()
    armAutoPause()
    pushEvent(eventType, meta)
    persistSnapshot()
  }, [armAutoPause, clearSuspendedState, ensureRecordId, persistSnapshot, pushEvent, startTicker])

  const start = React.useCallback((meta?: Record<string, boolean | number | string | null>) => {
    if (statusRef.current === 'running' || statusRef.current === 'completed') return
    clearCompetingSnapshots()
    beginRunning('start', meta)
  }, [beginRunning, clearCompetingSnapshots])

  const pause = React.useCallback((meta?: Record<string, boolean | number | string | null>) => {
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

  const resume = React.useCallback((meta?: Record<string, boolean | number | string | null>) => {
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
    async (meta?: Record<string, boolean | number | string | null>) => {
      if (!startedAtRef.current || statusRef.current === 'completed' || leaveHandledRef.current) {
        return null
      }
      leaveHandledRef.current = true
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
      pushEvent('leave_scene', meta, { persist: false })
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
      const record = buildRecord('left_page', suspendedAt)
      return persistRecord(record)
    },
    [
      autoPauseRef,
      buildRecord,
      clearTimer,
      hiddenPauseRef,
      persistRecord,
      persistSnapshot,
      pushEvent,
      resolvedAutomation.resumeWindowMs,
      stopTicker,
    ],
  )

  const registerActivity = React.useCallback((
    activityKind: TimerAutomationActivityKind,
    meta?: Record<string, boolean | number | string | null>,
  ) => {
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

  const logEvent = React.useCallback((type: SessionEventRecord['type'], meta?: Record<string, boolean | number | string | null>) => {
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
      meta?: Record<string, boolean | number | string | null>,
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
    [
      autoPauseRef,
      buildRecord,
      clearPersistedSnapshot,
      clearSuspendedState,
      clearTimer,
      hiddenPauseRef,
      persistCompletionRecord,
      persistRecord,
      pushEvent,
      stopTicker,
    ],
  )

  const reset = React.useCallback(() => {
    stopTicker()
    clearTimer(autoPauseRef)
    clearTimer(hiddenPauseRef)
    eventsRef.current = []
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
    setStatus('idle')
    setGlowState('idle')
    clearSuspendedState()
    clearPersistedSnapshot()
  }, [autoPauseRef, clearPersistedSnapshot, clearSuspendedState, clearTimer, hiddenPauseRef, stopTicker])

  React.useEffect(() => {
    if (!storageKey || restoredStorageKeyRef.current === storageKey) return
    restoredStorageKeyRef.current = storageKey
    clearCompetingSnapshots()
    let parsed: RestorableTimedSessionSnapshot | null = null
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      parsed = normalizeSnapshot(raw ? JSON.parse(raw) as PersistedTimedSessionSnapshotV2 | LegacyPersistedTimedSessionSnapshot : null)
    } catch {
      parsed = null
    }
    if (
      !parsed ||
      parsed.kind !== kind ||
      parsed.palaceId !== palaceId ||
      parsed.sourceKind !== sourceKind ||
      parsed.englishCourseId !== englishCourseId
    ) {
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

    if (parsed.suspended) {
      clearSuspendedState()
      statusRef.current = 'running'
      setStatus('running')
      startTicker()
      armAutoPause()
      pushEvent('resume', {
        reason: 'scene_return',
        ...(parsed.leaveMeta ?? {}),
      })
      persistSnapshot()
      return
    }

    if (parsed.status === 'paused') {
      statusRef.current = 'paused'
      setStatus('paused')
      persistSnapshot()
      return
    }

    statusRef.current = 'running'
    setStatus('running')
    startTicker()
    armAutoPause()
    persistSnapshot()
  }, [
    armAutoPause,
    clearCompetingSnapshots,
    clearPersistedSnapshot,
    clearSuspendedState,
    englishCourseId,
    kind,
    palaceId,
    persistSnapshot,
    sourceKind,
    startTicker,
    storageKey,
  ])

  React.useEffect(() => {
    if (glowState === 'idle') return
    const timer = window.setTimeout(() => setGlowState('idle'), 1000)
    return () => window.clearTimeout(timer)
  }, [glowState])

  React.useEffect(() => {
    const handleVisibility = () => {
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
      clearTimer(hiddenPauseRef)
      hiddenPauseRef.current = window.setTimeout(() => {
        pause({ reason: 'blur' })
      }, resolvedAutomation.hiddenPauseMs)
    }

    const handleFocus = () => {
      clearTimer(hiddenPauseRef)
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
