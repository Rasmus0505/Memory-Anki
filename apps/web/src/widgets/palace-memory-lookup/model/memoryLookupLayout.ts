import type { CSSProperties } from 'react'

export interface MemoryLookupLayout {
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
}

export type MemoryLookupResizeDirection =
  | 'n'
  | 'e'
  | 's'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

export interface MemoryLookupResizeState {
  direction: MemoryLookupResizeDirection
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

export const MEMORY_LOOKUP_LAYOUT_STORAGE_KEY = 'memory-anki-quiz-memory-lookup-layout'
export const MEMORY_LOOKUP_MIN_WIDTH = 360
export const MEMORY_LOOKUP_MIN_HEIGHT = 280
export const MEMORY_LOOKUP_VIEWPORT_MARGIN = 12
export const MEMORY_LOOKUP_VISIBLE_EDGE = 44
export const MEMORY_LOOKUP_CAPSULE_WIDTH = 280
export const MEMORY_LOOKUP_CAPSULE_HEIGHT = 44
export const MEMORY_LOOKUP_DRAG_CLICK_THRESHOLD_PX = 6

export const MEMORY_LOOKUP_RESIZE_HANDLE_STYLES: Record<
  MemoryLookupResizeDirection,
  CSSProperties
> = {
  n: {
    position: 'absolute',
    top: -6,
    left: 14,
    right: 14,
    height: 14,
    cursor: 'ns-resize',
  },
  e: {
    position: 'absolute',
    top: 14,
    right: -6,
    bottom: 14,
    width: 14,
    cursor: 'ew-resize',
  },
  s: {
    position: 'absolute',
    bottom: -6,
    left: 14,
    right: 14,
    height: 14,
    cursor: 'ns-resize',
  },
  w: {
    position: 'absolute',
    top: 14,
    left: -6,
    bottom: 14,
    width: 14,
    cursor: 'ew-resize',
  },
  nw: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 26,
    height: 26,
    cursor: 'nwse-resize',
  },
  ne: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    cursor: 'nesw-resize',
  },
  se: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 26,
    height: 26,
    cursor: 'nwse-resize',
  },
  sw: {
    position: 'absolute',
    left: -6,
    bottom: -6,
    width: 26,
    height: 26,
    cursor: 'nesw-resize',
  },
}

function sanitizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

export function buildDefaultMemoryLookupLayout(
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
  viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight,
): MemoryLookupLayout {
  const margin = MEMORY_LOOKUP_VIEWPORT_MARGIN
  const width = Math.min(980, Math.max(MEMORY_LOOKUP_MIN_WIDTH, viewportWidth - margin * 2))
  const height = Math.min(760, Math.max(MEMORY_LOOKUP_MIN_HEIGHT, viewportHeight - 96))
  return {
    x: Math.max(margin, viewportWidth - width - 24),
    y: Math.min(80, Math.max(margin, viewportHeight - height - margin)),
    width,
    height,
    collapsed: false,
  }
}

export function sanitizeMemoryLookupLayout(
  value: unknown,
  fallback = buildDefaultMemoryLookupLayout(),
): MemoryLookupLayout {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    x: sanitizeNumber(raw.x, fallback.x),
    y: sanitizeNumber(raw.y, fallback.y),
    width: Math.max(
      MEMORY_LOOKUP_MIN_WIDTH,
      sanitizeNumber(raw.width, fallback.width),
    ),
    height: Math.max(
      MEMORY_LOOKUP_MIN_HEIGHT,
      sanitizeNumber(raw.height, fallback.height),
    ),
    collapsed: Boolean(raw.collapsed),
  }
}

export function clampMemoryLookupLayoutToViewport(
  layout: MemoryLookupLayout,
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
  viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight,
) {
  const margin = MEMORY_LOOKUP_VIEWPORT_MARGIN
  const maxWidth = Math.max(MEMORY_LOOKUP_MIN_WIDTH, viewportWidth - margin * 2)
  const maxHeight = Math.max(MEMORY_LOOKUP_MIN_HEIGHT, viewportHeight - margin * 2)
  const width = Math.min(Math.max(MEMORY_LOOKUP_MIN_WIDTH, layout.width), maxWidth)
  const height = Math.min(Math.max(MEMORY_LOOKUP_MIN_HEIGHT, layout.height), maxHeight)
  const boundsWidth = layout.collapsed ? Math.min(MEMORY_LOOKUP_CAPSULE_WIDTH, viewportWidth) : width
  const boundsHeight = layout.collapsed ? Math.min(MEMORY_LOOKUP_CAPSULE_HEIGHT, viewportHeight) : height
  const visibleEdge = Math.min(MEMORY_LOOKUP_VISIBLE_EDGE, boundsWidth, boundsHeight)
  const minX = Math.min(margin, visibleEdge - boundsWidth)
  const maxX = Math.max(minX, boundsWidth > visibleEdge ? viewportWidth - visibleEdge : margin)
  const minY = Math.min(margin, visibleEdge - boundsHeight)
  const maxY = Math.max(minY, boundsHeight > visibleEdge ? viewportHeight - visibleEdge : margin)
  return {
    ...layout,
    x: Math.min(Math.max(minX, layout.x), maxX),
    y: Math.min(Math.max(minY, layout.y), maxY),
    width,
    height,
  }
}

export function resolveMemoryLookupLayout(
  value: unknown,
  viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth,
  viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight,
) {
  const fallback = buildDefaultMemoryLookupLayout(viewportWidth, viewportHeight)
  return clampMemoryLookupLayoutToViewport(
    sanitizeMemoryLookupLayout(value, fallback),
    viewportWidth,
    viewportHeight,
  )
}

export function readMemoryLookupLayout() {
  try {
    const raw = window.localStorage.getItem(MEMORY_LOOKUP_LAYOUT_STORAGE_KEY)
    if (!raw) return resolveMemoryLookupLayout(null)
    return resolveMemoryLookupLayout(JSON.parse(raw))
  } catch {
    return resolveMemoryLookupLayout(null)
  }
}

export function saveMemoryLookupLayout(layout: MemoryLookupLayout) {
  const sanitized = resolveMemoryLookupLayout(layout)
  try {
    window.localStorage.setItem(MEMORY_LOOKUP_LAYOUT_STORAGE_KEY, JSON.stringify(sanitized))
  } catch {
    // Ignore storage errors.
  }
  return sanitized
}

export function calculateResizedMemoryLookupLayout(
  resizeState: MemoryLookupResizeState,
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const deltaX = clientX - resizeState.startX
  const deltaY = clientY - resizeState.startY
  const viewportLeft = MEMORY_LOOKUP_VIEWPORT_MARGIN
  const viewportTop = MEMORY_LOOKUP_VIEWPORT_MARGIN
  const viewportRight = viewportWidth - MEMORY_LOOKUP_VIEWPORT_MARGIN
  const viewportBottom = viewportHeight - MEMORY_LOOKUP_VIEWPORT_MARGIN
  const availableWidth = Math.max(1, viewportRight - viewportLeft)
  const availableHeight = Math.max(1, viewportBottom - viewportTop)
  const minWidth = Math.min(MEMORY_LOOKUP_MIN_WIDTH, availableWidth)
  const minHeight = Math.min(MEMORY_LOOKUP_MIN_HEIGHT, availableHeight)
  const startRight = resizeState.x + resizeState.width
  const startBottom = resizeState.y + resizeState.height
  let nextLeft = resizeState.x
  let nextTop = resizeState.y
  let nextRight = startRight
  let nextBottom = startBottom

  if (resizeState.direction.includes('e')) {
    nextRight = Math.min(Math.max(startRight + deltaX, nextLeft + minWidth), viewportRight)
  }

  if (resizeState.direction.includes('s')) {
    nextBottom = Math.min(Math.max(startBottom + deltaY, nextTop + minHeight), viewportBottom)
  }

  if (resizeState.direction.includes('w')) {
    nextLeft = Math.max(Math.min(resizeState.x + deltaX, startRight - minWidth), viewportLeft)
  }

  if (resizeState.direction.includes('n')) {
    nextTop = Math.max(Math.min(resizeState.y + deltaY, startBottom - minHeight), viewportTop)
  }

  return {
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  }
}
