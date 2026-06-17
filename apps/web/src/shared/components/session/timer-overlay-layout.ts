export interface TimerOverlayLayout {
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
}

export const TIMER_OVERLAY_LAYOUT_STORAGE_KEY = 'memory-anki-timer-overlay-layout'
export const TIMER_OVERLAY_MIN_WIDTH = 220
export const TIMER_OVERLAY_MIN_HEIGHT = 176

export const DEFAULT_TIMER_OVERLAY_LAYOUT: TimerOverlayLayout = {
  x: 24,
  y: 96,
  width: 320,
  height: 208,
  collapsed: false,
}

function sanitizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

export function sanitizeTimerOverlayLayout(value: unknown): TimerOverlayLayout {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    x: sanitizeNumber(raw.x, DEFAULT_TIMER_OVERLAY_LAYOUT.x),
    y: sanitizeNumber(raw.y, DEFAULT_TIMER_OVERLAY_LAYOUT.y),
    width: Math.max(TIMER_OVERLAY_MIN_WIDTH, sanitizeNumber(raw.width, DEFAULT_TIMER_OVERLAY_LAYOUT.width)),
    height: Math.max(TIMER_OVERLAY_MIN_HEIGHT, sanitizeNumber(raw.height, DEFAULT_TIMER_OVERLAY_LAYOUT.height)),
    collapsed: Boolean(raw.collapsed),
  }
}

export function readTimerOverlayLayout() {
  try {
    const raw = window.localStorage.getItem(TIMER_OVERLAY_LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_TIMER_OVERLAY_LAYOUT
    return sanitizeTimerOverlayLayout(JSON.parse(raw))
  } catch {
    return DEFAULT_TIMER_OVERLAY_LAYOUT
  }
}

export function saveTimerOverlayLayout(layout: TimerOverlayLayout) {
  const sanitized = sanitizeTimerOverlayLayout(layout)
  try {
    window.localStorage.setItem(TIMER_OVERLAY_LAYOUT_STORAGE_KEY, JSON.stringify(sanitized))
  } catch {
    // Ignore storage errors.
  }
  return sanitized
}
