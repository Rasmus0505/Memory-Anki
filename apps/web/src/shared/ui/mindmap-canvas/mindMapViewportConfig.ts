/** Shared mind-map viewport zoom floors/ceilings (manual pan + fitView). */
export const MINDMAP_DEFAULT_ZOOM = 0.99
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

/**
 * Normalizes host-owned manual zoom preferences before they reach React Flow.
 * `undefined` represents an absent or unsafe preference, not the canvas default.
 */
export function normalizeMindMapManualZoom(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(MINDMAP_MANUAL_MAX_ZOOM, Math.max(MINDMAP_MANUAL_MIN_ZOOM, value))
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
