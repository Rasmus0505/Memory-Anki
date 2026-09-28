import { useCallback, useEffect, useState } from 'react'
import { getDesktopTimerBridge } from '@/shared/components/session/desktopTimerBridge'

/** Native window fullscreen on desktop, Fullscreen API fallback on PWA/browser. */
export function useFreestyleFullscreen() {
  const [freestyleFullscreen, setFreestyleFullscreen] = useState(false)

  useEffect(() => {
    if (!freestyleFullscreen) return
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFreestyleFullscreen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [freestyleFullscreen])

  useEffect(() => {
    const bridge = getDesktopTimerBridge()
    const unsubscribe = bridge?.onMainWindowFullscreenChange?.((active) => {
      setFreestyleFullscreen(active)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (bridge?.setMainWindowFullscreen) {
      bridge.setMainWindowFullscreen(freestyleFullscreen)
      return
    }

    // Installed PWA/browser fallback. The desktop shell uses native window
    // fullscreen so the Electron title bar and Windows taskbar disappear too.
    if (freestyleFullscreen) {
      if (document.fullscreenElement) return
      if (typeof document.documentElement.requestFullscreen === 'function') {
        void document.documentElement.requestFullscreen().catch(() => undefined)
      }
      return
    }
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      void document.exitFullscreen().catch(() => undefined)
    }
  }, [freestyleFullscreen])

  useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (bridge?.onMainWindowFullscreenChange) return
    const handleDocumentFullscreenChange = () => {
      setFreestyleFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleDocumentFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleDocumentFullscreenChange)
  }, [])

  useEffect(() => {
    return () => {
      getDesktopTimerBridge()?.setMainWindowFullscreen?.(false)
    }
  }, [])

  const toggleFreestyleFullscreen = useCallback((next?: boolean) => {
    setFreestyleFullscreen((current) => next ?? !current)
  }, [])

  return { freestyleFullscreen, toggleFreestyleFullscreen }
}
