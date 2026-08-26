/** Shared mind-map viewport zoom floors/ceilings (manual pan + fitView). */
export const MINDMAP_DEFAULT_ZOOM = 0.99
export const MINDMAP_MANUAL_MIN_ZOOM = 0.12
export const MINDMAP_MANUAL_MAX_ZOOM = 1.4
export const MINDMAP_FIT_MIN_ZOOM = 0.12
export const MINDMAP_FIT_MAX_ZOOM = 1.15
export const MINDMAP_MOBILE_FIT_MIN_ZOOM = 0.18
export const MINDMAP_MOBILE_FIT_MAX_ZOOM = 1.02

/**
 * Normalizes host-owned manual zoom preferences before they reach React Flow.
 * `undefined` represents an absent or unsafe preference, not the canvas default.
 */
export function normalizeMindMapManualZoom(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(MINDMAP_MANUAL_MAX_ZOOM, Math.max(MINDMAP_MANUAL_MIN_ZOOM, value))
}
