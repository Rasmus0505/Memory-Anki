import {
  currentViewportSize,
  pixelsFromRatio,
  readTimerOverlayMemory,
  viewportRatio,
  writeTimerOverlayMemory,
} from '@/shared/preferences/windowLayoutMemory'

export interface TimerOverlayLayout {
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
  /** True-hide: panel/capsule replaced by a corner restore control. */
  hidden: boolean
}

export interface TimerOverlayRemember {
  size?: boolean
  position?: boolean
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
  hidden: false,
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
    // Old persisted layouts omit `hidden`; treat missing as false.
    hidden: Boolean(raw.hidden),
  }
}

function layoutFromRatios(memory: {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  collapsed: boolean
  hidden: boolean
}) {
  const viewport = currentViewportSize()
  return sanitizeTimerOverlayLayout({
    x: pixelsFromRatio(memory.xRatio, viewport.width),
    y: pixelsFromRatio(memory.yRatio, viewport.height),
    width: pixelsFromRatio(memory.widthRatio, viewport.width),
    height: pixelsFromRatio(memory.heightRatio, viewport.height),
    collapsed: memory.collapsed,
    hidden: memory.hidden,
  })
}

export function readTimerOverlayLayout() {
  const remembered = readTimerOverlayMemory()
  if (remembered) return layoutFromRatios(remembered)
  try {
    const raw = window.localStorage.getItem(TIMER_OVERLAY_LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_TIMER_OVERLAY_LAYOUT
    return sanitizeTimerOverlayLayout(JSON.parse(raw))
  } catch {
    return DEFAULT_TIMER_OVERLAY_LAYOUT
  }
}

export function saveTimerOverlayLayout(
  layout: TimerOverlayLayout,
  remember: TimerOverlayRemember = { size: true, position: true },
) {
  const sanitized = sanitizeTimerOverlayLayout(layout)
  const viewport = currentViewportSize()
  const previous = readTimerOverlayMemory()
  const rememberSize = remember.size !== false
  const rememberPosition = remember.position !== false
  const seeded = !previous
  writeTimerOverlayMemory({
    xRatio: rememberPosition || seeded
      ? viewportRatio(sanitized.x, viewport.width, -1.5, 1.5)
      : previous.xRatio,
    yRatio: rememberPosition || seeded
      ? viewportRatio(sanitized.y, viewport.height, -1.5, 1.5)
      : previous.yRatio,
    widthRatio: rememberSize || seeded
      ? viewportRatio(sanitized.width, viewport.width, 0.05, 1.5)
      : previous.widthRatio,
    heightRatio: rememberSize || seeded
      ? viewportRatio(sanitized.height, viewport.height, 0.05, 1.5)
      : previous.heightRatio,
    collapsed: sanitized.collapsed,
    hidden: sanitized.hidden,
  })
  try {
    window.localStorage.setItem(TIMER_OVERLAY_LAYOUT_STORAGE_KEY, JSON.stringify(sanitized))
  } catch {
    // Ignore storage errors.
  }
  return sanitized
}
