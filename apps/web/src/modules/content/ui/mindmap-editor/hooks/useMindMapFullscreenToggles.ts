import { useCallback } from 'react'

interface FocusToggleCapability {
  handleFocusToggle?: () => boolean
}

export interface UseMindMapFullscreenTogglesOptions {
  capabilities: ReadonlyArray<FocusToggleCapability>
  delegateFullscreenToHost: boolean
  onFullscreenToggle?: () => void
  toggleNativeFullscreen: () => void
  presentationStrategy: string
  toggleCanvasFullscreen: () => void
  toggleViewportFullscreen: () => void
}

/**
 * Two fullscreen verbs with the same capability-first rule: a host capability
 * wins, then an immersive host, then the desktop/viewport fallback.
 */
export function useMindMapFullscreenToggles({
  capabilities,
  delegateFullscreenToHost,
  onFullscreenToggle,
  toggleNativeFullscreen,
  presentationStrategy,
  toggleCanvasFullscreen,
  toggleViewportFullscreen,
}: UseMindMapFullscreenTogglesOptions) {
  const handleSystemFullscreenToggle = useCallback(() => {
    const handled = capabilities.some((capability) => capability.handleFocusToggle?.())
    if (handled) return
    if (delegateFullscreenToHost) {
      onFullscreenToggle?.()
      return
    }
    // Desktop: Fullscreen API (system fullscreen). Host immersive layout stays separate.
    toggleNativeFullscreen()
  }, [capabilities, delegateFullscreenToHost, onFullscreenToggle, toggleNativeFullscreen])

  const handleWebpageFullscreenToggle = useCallback(() => {
    const handled = capabilities.some((capability) => capability.handleFocusToggle?.())
    if (handled) return
    if (delegateFullscreenToHost) {
      onFullscreenToggle?.()
      return
    }
    // Viewport CSS lock inside the browser window so the OS window can still be dragged.
    if (presentationStrategy === 'viewport-only') {
      toggleCanvasFullscreen()
      return
    }
    toggleViewportFullscreen()
  }, [
    capabilities,
    delegateFullscreenToHost,
    onFullscreenToggle,
    presentationStrategy,
    toggleCanvasFullscreen,
    toggleViewportFullscreen,
  ])

  return { handleSystemFullscreenToggle, handleWebpageFullscreenToggle }
}
