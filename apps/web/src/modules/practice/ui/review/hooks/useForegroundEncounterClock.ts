import { useCallback, useEffect, useRef } from 'react'
import {
  isLiveForegroundClockSuppressed,
  subscribeLiveForegroundClock,
} from '@/modules/session/public'
import {
  STUDY_AWAY_GRACE_MS,
  isStudyClockCounting,
  subscribeStudyClockPresence,
} from '@/modules/practice/ui/studyClockPresence'

const STORAGE_KEY_PREFIX = 'memory_anki_review_foreground_seconds:'
const TICK_INTERVAL_MS = 1000
const MAX_CONTIGUOUS_TICK_SECONDS = STUDY_AWAY_GRACE_MS / 1000

export function useForegroundEncounterClock({
  encounterId,
  active,
  open,
  canAccumulate = true,
}: {
  encounterId: string | null
  active: boolean
  open: boolean
  canAccumulate?: boolean
}) {
  const secondsRef = useRef(0)
  const tickAtRef = useRef<number | null>(null)
  const storageKey = encounterId ? `${STORAGE_KEY_PREFIX}${encounterId}` : null

  const persist = useCallback(() => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, String(secondsRef.current))
    } catch {
      // Crash recovery is best effort; the encounter API remains authoritative.
    }
  }, [storageKey])

  const tick = useCallback(() => {
    const now = Date.now()
    if (
      !canAccumulate
      || isLiveForegroundClockSuppressed()
      || !active
      || !open
      || !isStudyClockCounting(now)
    ) {
      tickAtRef.current = null
      return
    }
    if (tickAtRef.current == null) {
      tickAtRef.current = now
      return
    }
    const delta = (now - tickAtRef.current) / 1000
    // A short leave still counts. A longer thaw was not observed study, so
    // restart without backfilling that gap.
    if (delta >= 0 && delta <= MAX_CONTIGUOUS_TICK_SECONDS) {
      secondsRef.current += delta
      persist()
    }
    tickAtRef.current = now
  }, [active, canAccumulate, open, persist])

  useEffect(() => {
    secondsRef.current = 0
    tickAtRef.current = null
    if (!storageKey) return
    try {
      const saved = Number(window.localStorage.getItem(storageKey))
      if (Number.isFinite(saved) && saved > 0) secondsRef.current = saved
    } catch {
      // Ignore unavailable storage.
    }
  }, [storageKey])

  useEffect(() => {
    tick()
    if (!active || !open) return
    const interval = window.setInterval(tick, TICK_INTERVAL_MS)
    const onVisibilityChange = () => tick()
    const onWindowFocusChange = () => tick()
    const stopLiveClock = subscribeLiveForegroundClock(() => tick())
    const stopPresence = subscribeStudyClockPresence(() => tick())
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onVisibilityChange)
    window.addEventListener('focus', onWindowFocusChange)
    window.addEventListener('blur', onWindowFocusChange)
    return () => {
      tick()
      window.clearInterval(interval)
      stopLiveClock()
      stopPresence()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onVisibilityChange)
      window.removeEventListener('focus', onWindowFocusChange)
      window.removeEventListener('blur', onWindowFocusChange)
    }
  }, [active, open, tick])

  const getEffectiveSeconds = useCallback(() => {
    tick()
    return Math.max(0, Math.round(secondsRef.current))
  }, [tick])

  const clear = useCallback(() => {
    if (!storageKey) return
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Ignore unavailable storage.
    }
  }, [storageKey])

  return { getEffectiveSeconds, clear }
}
