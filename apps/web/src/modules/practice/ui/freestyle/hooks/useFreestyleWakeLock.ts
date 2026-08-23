import { useEffect } from 'react'

/**
 * Keep the screen awake while the immersive feed is the visible foreground.
 * Released on hide / unmount so a backgrounded PWA does not hold the lock.
 */
export function useFreestyleWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    const wakeLock = navigator.wakeLock
    if (!wakeLock?.request) return

    let released = false
    let sentinel: WakeLockSentinel | null = null

    const request = async () => {
      if (released || document.visibilityState !== 'visible') return
      try {
        sentinel = await wakeLock.request('screen')
      } catch {
        sentinel = null
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void request()
        return
      }
      void sentinel?.release().catch(() => undefined)
      sentinel = null
    }

    void request()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibility)
      void sentinel?.release().catch(() => undefined)
    }
  }, [active])
}
