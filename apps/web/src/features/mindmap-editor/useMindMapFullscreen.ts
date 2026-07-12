import { useCallback, useEffect, useState } from 'react'

interface MindMapFullscreenOptions {
  immersiveModeActive: boolean
  onFullscreenChange?: (active: boolean) => void
  onFullscreenToggle?: (active?: boolean) => void
  requestFitView: () => void
}

export function useMindMapFullscreen({
  immersiveModeActive,
  onFullscreenChange,
  onFullscreenToggle,
  requestFitView,
}: MindMapFullscreenOptions) {
  const [active, setActive] = useState(false)

  const requestFitViewOnNextFrame = useCallback(() => {
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => window.requestAnimationFrame(requestFitView))
  }, [requestFitView])

  const enter = useCallback(async () => {
    setActive(true)
    onFullscreenChange?.(true)
    requestFitViewOnNextFrame()
  }, [onFullscreenChange, requestFitViewOnNextFrame])

  const exit = useCallback(async () => {
    setActive(false)
    onFullscreenChange?.(false)
    requestFitViewOnNextFrame()
  }, [onFullscreenChange, requestFitViewOnNextFrame])

  const toggle = useCallback(() => {
    if (active) {
      void exit()
      return
    }
    if (immersiveModeActive) onFullscreenToggle?.(false)
    void enter()
  }, [active, enter, exit, immersiveModeActive, onFullscreenToggle])

  useEffect(() => {
    if (!active) return
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [active])

  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    const root = document.documentElement
    const previousHeight = root.style.getPropertyValue('--memory-anki-mindmap-fullscreen-height')
    const updateViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      root.style.setProperty('--memory-anki-mindmap-fullscreen-height', `${height}px`)
    }
    updateViewportHeight()
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    window.visualViewport?.addEventListener('scroll', updateViewportHeight)
    window.addEventListener('resize', updateViewportHeight)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight)
      window.removeEventListener('resize', updateViewportHeight)
      if (previousHeight) root.style.setProperty('--memory-anki-mindmap-fullscreen-height', previousHeight)
      else root.style.removeProperty('--memory-anki-mindmap-fullscreen-height')
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      void exit()
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [active, exit])

  return { active, enter, exit, toggle }
}
