import { useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY_PREFIX = 'memory_anki_review_foreground_seconds:'
const TICK_INTERVAL_MS = 1000
const MAX_CONTIGUOUS_TICK_SECONDS = 5

export function useForegroundEncounterClock({
  encounterId,
  active,
  open,
}: {
  encounterId: string | null
  active: boolean
  open: boolean
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
    if (!active || !open || document.visibilityState !== 'visible') {
      tickAtRef.current = null
      return
    }
    const now = performance.now()
    if (tickAtRef.current == null) {
      tickAtRef.current = now
      return
    }
    const delta = (now - tickAtRef.current) / 1000
    // A browser thaw can deliver one very late timer callback. That gap was not
    // observed foreground activity, so restart the clock without backfilling it.
    if (delta >= 0 && delta <= MAX_CONTIGUOUS_TICK_SECONDS) {
      secondsRef.current += delta
      persist()
    }
    tickAtRef.current = now
  }, [active, open, persist])

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
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onVisibilityChange)
    return () => {
      tick()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onVisibilityChange)
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
