import * as React from 'react'

/**
 * Hold a screen wake lock while `active` is true.
 *
 * Without this a phone dims and locks mid-recitation, which hides the page and
 * (after the background grace window) suspends the timer. The API is absent on
 * iOS Safari before 16.4 and on some desktop browsers, so every failure path is
 * a silent no-op rather than an error.
 */
export function useScreenWakeLock(active: boolean) {
  const sentinelRef = React.useRef<WakeLockSentinel | null>(null)

  React.useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return
    }

    // Effect teardown can run before an in-flight request resolves; the flag
    // makes sure that late sentinel is released instead of leaking.
    let cancelled = false

    const release = () => {
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      void sentinel?.release().catch(() => {})
    }

    const acquire = async () => {
      if (cancelled || sentinelRef.current || document.visibilityState !== 'visible') return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        // The browser drops the lock whenever the page hides; clear our handle
        // so the visibility listener below knows to request a fresh one.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
      } catch {
        // Denied by the browser (low battery, unsupported, not user-visible).
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      release()
    }
  }, [active])
}
