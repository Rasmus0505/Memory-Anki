import * as React from 'react'
import {
  appendTimeRecord,
  getWeeklyLocalSessionStats,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type SessionKind,
  type TimeSessionRecord,
} from '@/entities/session/model'

const AUTO_PAUSE_MS = 2 * 60 * 1000
const HIDDEN_PAUSE_MS = 15 * 1000

export interface TimedSessionOptions {
  kind: SessionKind
  title: string
  palaceId: number | null
  autoPauseMs?: number
  hiddenPauseMs?: number
}

type SessionStatus = 'idle' | 'running' | 'paused' | 'completed'
type GlowState = 'idle' | 'running' | 'paused'

export interface TimedSessionController {
  effectiveSeconds: number
  pauseCount: number
  status: SessionStatus
  startedAt: string | null
  durationEdited: boolean
  glowState: GlowState
  start: (meta?: Record<string, boolean | number | string | null>) => void
  pause: (meta?: Record<string, boolean | number | string | null>) => void
  resume: (meta?: Record<string, boolean | number | string | null>) => void
  registerActivity: (meta?: Record<string, boolean | number | string | null>) => void
  logEvent: (type: SessionEventRecord['type'], meta?: Record<string, boolean | number | string | null>) => void
  adjustDuration: (seconds: number) => void
  complete: (
    method: SessionCompletionMethod,
    meta?: Record<string, boolean | number | string | null>,
  ) => Promise<TimeSessionRecord | null>
  reset: () => void
}

function nowIso() {
  return new Date().toISOString()
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useTimedSession({
  kind,
  title,
  palaceId,
  autoPauseMs = AUTO_PAUSE_MS,
  hiddenPauseMs = HIDDEN_PAUSE_MS,
}: TimedSessionOptions): TimedSessionController {
  const [effectiveSeconds, setEffectiveSeconds] = React.useState(0)
  const [pauseCount, setPauseCount] = React.useState(0)
  const [status, setStatus] = React.useState<SessionStatus>('idle')
  const [startedAt, setStartedAt] = React.useState<string | null>(null)
  const [durationEdited, setDurationEdited] = React.useState(false)
  const [glowState, setGlowState] = React.useState<GlowState>('idle')

  const statusRef = React.useRef<SessionStatus>('idle')
  const lastTickAtRef = React.useRef<number | null>(null)
  const eventsRef = React.useRef<SessionEventRecord[]>([])
  const effectiveSecondsRef = React.useRef(0)
  const pauseCountRef = React.useRef(0)
  const startedAtRef = React.useRef<string | null>(null)
  const durationEditedRef = React.useRef(false)
  const tickerRef = React.useRef<number | null>(null)
  const autoPauseRef = React.useRef<number | null>(null)
  const hiddenPauseRef = React.useRef<number | null>(null)

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

  const pushEvent = React.useCallback((type: SessionEventRecord['type'], meta?: Record<string, boolean | number | string | null>) => {
    eventsRef.current.push({ type, at: nowIso(), ...(meta ? { meta } : {}) })
  }, [])

  const syncTick = React.useCallback(() => {
    if (statusRef.current !== 'running' || lastTickAtRef.current == null) return
    const currentMs = Date.now()
    const elapsedMs = Math.max(0, currentMs - lastTickAtRef.current)
    const diffSeconds = Math.floor(elapsedMs / 1000)
    if (diffSeconds > 0) {
      effectiveSecondsRef.current += diffSeconds
      setEffectiveSeconds(effectiveSecondsRef.current)
      lastTickAtRef.current += diffSeconds * 1000
      return
    }
    if (elapsedMs > 0 && elapsedMs < 1000) {
      lastTickAtRef.current = currentMs - elapsedMs
    }
  }, [])

  const armAutoPause = React.useCallback(() => {
    clearTimer(autoPauseRef)
    if (statusRef.current !== 'running') return
    autoPauseRef.current = window.setTimeout(() => {
      if (statusRef.current !== 'running') return
      pauseCountRef.current += 1
      setPauseCount(pauseCountRef.current)
      statusRef.current = 'paused'
      setStatus('paused')
      setGlowState('paused')
      syncTick()
      pushEvent('pause', { reason: 'inactive' })
    }, autoPauseMs)
  }, [autoPauseMs, clearTimer, pushEvent, syncTick])

  const startTicker = React.useCallback(() => {
    clearIntervalTimer(tickerRef)
    lastTickAtRef.current = Date.now()
    tickerRef.current = window.setInterval(() => {
      syncTick()
    }, 250)
  }, [clearIntervalTimer, syncTick])

  const stopTicker = React.useCallback(() => {
    syncTick()
    clearIntervalTimer(tickerRef)
    lastTickAtRef.current = null
  }, [clearIntervalTimer, syncTick])

  const beginRunning = React.useCallback((eventType: 'start' | 'resume', meta?: Record<string, boolean | number | string | null>) => {
    const nextStartedAt = startedAtRef.current ?? nowIso()
    setStartedAt(nextStartedAt)
    startedAtRef.current = nextStartedAt
    statusRef.current = 'running'
    setStatus('running')
    setGlowState('running')
    startTicker()
    armAutoPause()
    pushEvent(eventType, meta)
  }, [armAutoPause, pushEvent, startTicker])

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
  }, [clearTimer, pushEvent, stopTicker])

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

  const registerActivity = React.useCallback((meta?: Record<string, boolean | number | string | null>) => {
    if (statusRef.current === 'idle') {
      start({ source: 'auto', ...(meta ?? {}) })
      return
    }
    if (statusRef.current === 'paused') {
      resume({ source: 'auto', ...(meta ?? {}) })
      return
    }
    if (statusRef.current === 'running') {
      armAutoPause()
    }
  }, [armAutoPause, resume, start])

  const logEvent = React.useCallback((type: SessionEventRecord['type'], meta?: Record<string, boolean | number | string | null>) => {
    pushEvent(type, meta)
  }, [pushEvent])

  const adjustDuration = React.useCallback((seconds: number) => {
    effectiveSecondsRef.current = Math.max(0, Math.round(seconds))
    setEffectiveSeconds(effectiveSecondsRef.current)
    setDurationEdited(true)
    durationEditedRef.current = true
    pushEvent('adjust_duration', { seconds: effectiveSecondsRef.current })
  }, [pushEvent])

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
        title,
        startedAt: startedAtRef.current,
        endedAt: nowIso(),
        effectiveSeconds: effectiveSecondsRef.current,
        pauseCount: pauseCountRef.current,
        completionMethod: method,
        durationEdited: durationEditedRef.current,
        events: [...eventsRef.current],
      }
      return appendTimeRecord(record)
    },
    [autoPauseRef, clearTimer, hiddenPauseRef, kind, palaceId, pushEvent, stopTicker, title],
  )

  const reset = React.useCallback(() => {
    stopTicker()
    clearTimer(autoPauseRef)
    clearTimer(hiddenPauseRef)
    eventsRef.current = []
    effectiveSecondsRef.current = 0
    pauseCountRef.current = 0
    startedAtRef.current = null
    durationEditedRef.current = false
    setEffectiveSeconds(0)
    setPauseCount(0)
    setStartedAt(null)
    setDurationEdited(false)
    statusRef.current = 'idle'
    setStatus('idle')
    setGlowState('idle')
  }, [autoPauseRef, clearTimer, hiddenPauseRef, stopTicker])

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
        }, hiddenPauseMs)
        return
      }
      clearTimer(hiddenPauseRef)
      if (statusRef.current === 'paused') {
        registerActivity({ reason: 'visible' })
      }
    }

    const handleBlur = () => {
      clearTimer(hiddenPauseRef)
      hiddenPauseRef.current = window.setTimeout(() => {
        pause({ reason: 'blur' })
      }, hiddenPauseMs)
    }

    const handleFocus = () => {
      clearTimer(hiddenPauseRef)
      if (statusRef.current === 'paused') {
        registerActivity({ reason: 'focus' })
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
  }, [autoPauseRef, clearIntervalTimer, clearTimer, hiddenPauseMs, pause, registerActivity])

  return {
    effectiveSeconds,
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
