/**
 * Shared mind-map viewport zoom floors/ceilings (manual pan + fitView).
 * Default is exactly 1: scale(0.99) rasterizes glyphs and looks soft on Windows.
 */
export const MINDMAP_DEFAULT_ZOOM = 1
export const MINDMAP_DEFAULT_VIEWPORT_X = 4
export const MINDMAP_DEFAULT_VIEWPORT_Y = 18
export const MINDMAP_MANUAL_MIN_ZOOM = 0.12
export const MINDMAP_MANUAL_MAX_ZOOM = 1.4
export const MINDMAP_FIT_MIN_ZOOM = 0.12
export const MINDMAP_FIT_MAX_ZOOM = 1.35
export const MINDMAP_MOBILE_FIT_MIN_ZOOM = 0.18
export const MINDMAP_MOBILE_FIT_MAX_ZOOM = 1.15
export const MINDMAP_FIT_PADDING = 0.04
export const MINDMAP_FOCUS_FIT_PADDING = 0.03
export const MINDMAP_BRANCH_FIT_PADDING = 0.06
export const MINDMAP_MOBILE_GUIDED_FIT_PADDING = 0.18
export const MINDMAP_MOBILE_GUIDED_BRANCH_FIT_PADDING = 0.16
/** Screen padding kept around a card brought into view by a reveal pan. */
export const MINDMAP_REVEAL_INTO_VIEW_PADDING_PX = 32
/** Short pan used when a reveal command brings a clipped card into view. */
export const MINDMAP_REVEAL_INTO_VIEW_DURATION_MS = 200

/**
 * Normalizes host-owned manual zoom preferences before they reach React Flow.
 * `undefined` represents an absent or unsafe preference, not the canvas default.
 */
export function normalizeMindMapManualZoom(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(MINDMAP_MANUAL_MAX_ZOOM, Math.max(MINDMAP_MANUAL_MIN_ZOOM, value))
}

/**
 * At zoom 1, fractional viewport translates rasterize glyphs on Windows.
 * Other zooms are an intentional scale and cannot be made pixel-crisp here.
 */
export function crispMindMapViewport<T extends { x: number; y: number; zoom: number }>(viewport: T): T {
  if (!Number.isFinite(viewport.zoom) || Math.abs(viewport.zoom - 1) > 0.0001) return viewport
  const x = Math.round(viewport.x)
  const y = Math.round(viewport.y)
  if (x === viewport.x && y === viewport.y && viewport.zoom === 1) return viewport
  return { ...viewport, x, y, zoom: 1 }
}

export function isPristineMindMapViewport(
  viewport: { x: number; y: number; zoom: number },
  preferredZoom?: number,
) {
  const zoom = normalizeMindMapManualZoom(preferredZoom) ?? MINDMAP_DEFAULT_ZOOM
  return (
    Math.abs(viewport.x - MINDMAP_DEFAULT_VIEWPORT_X) < 0.51 &&
    Math.abs(viewport.y - MINDMAP_DEFAULT_VIEWPORT_Y) < 0.51 &&
    Math.abs(viewport.zoom - zoom) < 0.0001
  )
}
