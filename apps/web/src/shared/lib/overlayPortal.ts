
/**
 * Resolve where floating overlays (dropdowns, popovers) should portal.
 *
 * Native Fullscreen API only paints the fullscreen subtree. Portaling to
 * document.body while a mind-map frame is fullscreen makes the menu open
 * "successfully" but remain invisible — which looks like a dead click.
 *
 * Viewport (CSS) fullscreen keeps the normal document tree; body is fine
 * there as long as overlay z-index clears the fullscreen host (z-index 230).
 */
export function resolveOverlayPortalContainer(
  preferred?: Element | null,
): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined

  if (preferred instanceof HTMLElement) return preferred

  const webkitDocument = document as Document & {
    webkitFullscreenElement?: Element | null
    webkitCurrentFullScreenElement?: Element | null
  }
  const fullscreen =
    document.fullscreenElement
    ?? webkitDocument.webkitFullscreenElement
    ?? webkitDocument.webkitCurrentFullScreenElement
    ?? null

  if (fullscreen instanceof HTMLElement) return fullscreen
  return document.body
}
