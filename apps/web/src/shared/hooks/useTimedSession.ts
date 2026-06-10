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

export interface TimedSessionOptions {
  kind: SessionKind
  title: string
  palaceId: number | null
  automationScene?: TimerAutomationScene
  sourceKind?: 'palace' | 'english' | null
  englishCourseId?: number | null
  autoPauseMs?: number
  hiddenPauseMs?: number
  persistKey?: string | null
  persistCompletionRecord?: boolean
}

type SessionStatus = 'idle' | 'running' | 'paused' | 'completed'
type GlowState = 'idle' | 'running' | 'paused'

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

interface PersistedTimedSessionSnapshot {
  version: 1
  kind: SessionKind
  palaceId: number | null
  sourceKind: 'palace' | 'english' | null
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

interface ResolvedTimedSessionAutomation {
  autoPauseMs: number
  hiddenPauseMs: number
  autoPauseRollbackSeconds: number
}

function nowIso() {
  return formatLocalApiDateTime(new Date())
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
  const restoredRef = React.useRef(false)
  const [automationConfig, setAutomationConfig] = React.useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )

  const resolvedAutomation = React.useMemo<ResolvedTimedSessionAutomation>(() => {
    const sceneRule = getTimerAutomationRule(automationScene, automationConfig)
    return {
      autoPauseMs: Math.max(0, Math.round(autoPauseMs ?? sceneRule.inactiveAutoPauseSeconds * 1000)),
      hiddenPauseMs: Math.max(0, Math.round(hiddenPauseMs ?? sceneRule.hiddenAutoPauseSeconds * 1000)),
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
    () => (persistKey ? `memory-anki-timed-session:${persistKey}` : null),
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

  const persistSnapshot = React.useCallback((statusOverride?: SessionStatus) => {
    if (!storageKey) return
    const snapshotStatus = statusOverride ?? statusRef.current
    if (!startedAtRef.current || snapshotStatus === 'idle' || snapshotStatus === 'completed') {
      clearPersistedSnapshot()
      return
    }
    const snapshot: PersistedTimedSessionSnapshot = {
      version: 1,
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
    }
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot))
    } catch {
      // Ignore storage errors in private mode or restricted environments.
    }
  }, [clearPersistedSnapshot, englishCourseId, kind, palaceId, sourceKind, storageKey, title])

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

  const getIdleSecondsAt = React.useCallback((currentMs: number) => {
    if (lastActivityAtRef.current == null) return 0
    return Math.max(0, Math.floor((currentMs - lastActivityAtRef.current) / 1000))
  }, [])

  const pushEvent = React.useCallback((type: SessionEventRecord['type'], meta?: Record<string, boolean | number | string | null>) => {
    eventsRef.current.push({ type, at: nowIso(), ...(meta ? { meta } : {}) })
    persistSnapshot()
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

  const persistSnapshotForUnload = React.useCallback(() => {
    if (!storageKey) return
    if (statusRef.current === 'running') {
      stopTicker(Date.now())
      persistSnapshot('paused')
      return
    }
    persistSnapshot()
  }, [persistSnapshot, storageKey, stopTicker])

  const beginRunning = React.useCallback((eventType: 'start' | 'resume', meta?: Record<string, boolean | number | string | null>) => {
    const nextStartedAt = startedAtRef.current ?? nowIso()
    setStartedAt(nextStartedAt)
    startedAtRef.current = nextStartedAt
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
  }, [armAutoPause, persistSnapshot, pushEvent, startTicker])

  const start = React.useCallback((meta?: Record<string, boolean | number | string | null>) => {
    if (statusRef.current === 'running' || statusRef.current === 'completed') return
    beginRunning('start', meta)
  }, [beginRunning])

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
      beginRunning('start', meta)
      return
    }
    if (statusRef.current === 'paused') {
      beginRunning('resume', meta)
    }
  }, [beginRunning])

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
      pushEvent(
        method === 'auto_complete'
          ? 'auto_complete'
          : method === 'manual_complete'
            ? 'manual_complete'
            : 'complete',
        meta,
      )

      const record: TimeSessionRecord = {
        id: randomId(),
        kind,
        palaceId,
        sourceKind,
        englishCourseId,
        title,
        startedAt: startedAtRef.current,
        endedAt: nowIso(),
        effectiveSeconds: effectiveSecondsRef.current,
        pauseCount: pauseCountRef.current,
        completionMethod: method,
        durationEdited: durationEditedRef.current,
        events: [...eventsRef.current],
      }
      clearPersistedSnapshot()
      if (!persistCompletionRecord) {
        return record
      }
      try {
        return await appendTimeRecord(record)
      } catch {
        return record
      }
    },
    [
      autoPauseRef,
      clearPersistedSnapshot,
      clearTimer,
      englishCourseId,
      hiddenPauseRef,
      kind,
      palaceId,
      persistCompletionRecord,
      pushEvent,
      sourceKind,
      stopTicker,
      title,
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
    setEffectiveSeconds(0)
    setIdleSeconds(0)
    setPauseCount(0)
    setStartedAt(null)
    setDurationEdited(false)
    statusRef.current = 'idle'
    setStatus('idle')
    setGlowState('idle')
    clearPersistedSnapshot()
  }, [autoPauseRef, clearPersistedSnapshot, clearTimer, hiddenPauseRef, stopTicker])

  React.useEffect(() => {
    if (!storageKey || restoredRef.current) return
    restoredRef.current = true
    let parsed: PersistedTimedSessionSnapshot | null = null
    try {
      const raw = window.sessionStorage.getItem(storageKey)
      parsed = raw ? (JSON.parse(raw) as PersistedTimedSessionSnapshot) : null
    } catch {
      parsed = null
    }
    if (
      !parsed ||
      parsed.version !== 1 ||
      parsed.kind !== kind ||
      parsed.palaceId !== palaceId ||
      parsed.sourceKind !== sourceKind ||
      parsed.englishCourseId !== englishCourseId
    ) {
      clearPersistedSnapshot()
      return
    }
    if (!parsed.startedAt || parsed.status === 'idle' || parsed.status === 'completed') {
      clearPersistedSnapshot()
      return
    }

    const persistedAtMs = new Date(parsed.persistedAt).getTime()
    const restoreNowMs = Date.now()
    const elapsedSincePersistSeconds =
      parsed.status === 'running' && Number.isFinite(persistedAtMs)
        ? Math.max(0, Math.floor((restoreNowMs - persistedAtMs) / 1000))
        : 0
    const restoredEffectiveSeconds = Math.max(
      0,
      Math.round(parsed.effectiveSeconds + elapsedSincePersistSeconds),
    )

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
    clearPersistedSnapshot,
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
      persistSnapshotForUnload()
    }

    window.addEventListener('beforeunload', handlePersistOnUnload)
    window.addEventListener('pagehide', handlePersistOnUnload)

    return () => {
      window.removeEventListener('beforeunload', handlePersistOnUnload)
      window.removeEventListener('pagehide', handlePersistOnUnload)
    }
  }, [persistSnapshotForUnload, storageKey])

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
    registerActivity,
    logEvent,
    adjustDuration,
    complete,
    reset,
  }
}

export { getWeeklyLocalSessionStats }
export { shouldAutoStartOnPageEnter } from '@/shared/components/session/timer-automation-config'
