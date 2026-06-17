import type { CSSProperties } from 'react'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import type { TimerFocusScene } from '@/shared/components/session/timer-focus-config'
import {
  sanitizeTimerOverlayLayout,
  TIMER_OVERLAY_MIN_HEIGHT,
  TIMER_OVERLAY_MIN_WIDTH,
  type TimerOverlayLayout,
} from '@/shared/components/session/timer-overlay-layout'

export interface GlobalTimerRegistration {
  sessionId: string
  scene: TimerFocusScene
  title: string
  timer: TimedSessionController
  isRouteActive: boolean
  becameActiveAt: number
}

export const OVERLAY_VIEWPORT_MARGIN = 12
export const TIMER_DRAG_CLICK_THRESHOLD_PX = 6

export type ResizeHandleDirection =
  | 'n'
  | 'e'
  | 's'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

export interface TimerResizeState {
  direction: ResizeHandleDirection
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

export const TIMER_RESIZE_HANDLE_STYLES: Record<ResizeHandleDirection, CSSProperties> = {
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

export function formatClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const minutes = `${Math.floor(safeSeconds / 60)}`.padStart(2, '0')
  const seconds = `${safeSeconds % 60}`.padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function formatPrimaryProgress(elapsedSeconds: number, totalSeconds: number) {
  const safeTargetSeconds = Math.max(1, Math.round(totalSeconds))
  const ratio = (Math.max(0, elapsedSeconds) / safeTargetSeconds).toFixed(2)
  return `${formatClock(elapsedSeconds)}/${formatClock(totalSeconds)}  ${ratio}`
}

export function formatIdlePrimaryProgress(totalSeconds: number) {
  return `${formatClock(totalSeconds)}/${formatClock(totalSeconds)}  1.00`
}

export function clampTimerOverlayLayoutToViewport(layout: TimerOverlayLayout) {
  if (typeof window === 'undefined') return layout
  const minMargin = OVERLAY_VIEWPORT_MARGIN
  const maxWidth = Math.max(TIMER_OVERLAY_MIN_WIDTH, window.innerWidth - minMargin * 2)
  const maxHeight = Math.max(TIMER_OVERLAY_MIN_HEIGHT, window.innerHeight - minMargin * 2)
  const width = Math.min(Math.max(TIMER_OVERLAY_MIN_WIDTH, layout.width), maxWidth)
  const height = Math.min(Math.max(TIMER_OVERLAY_MIN_HEIGHT, layout.height), maxHeight)
  const maxX = Math.max(minMargin, window.innerWidth - width - minMargin)
  const maxY = Math.max(minMargin, window.innerHeight - height - minMargin)
  return {
    ...layout,
    x: Math.min(Math.max(minMargin, layout.x), maxX),
    y: Math.min(Math.max(minMargin, layout.y), maxY),
    width,
    height,
  }
}

export function resolveFloatingTimerLayout(layout: TimerOverlayLayout) {
  return clampTimerOverlayLayoutToViewport(sanitizeTimerOverlayLayout(layout))
}

export function calculateResizedTimerOverlayLayout(
  resizeState: TimerResizeState,
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const deltaX = clientX - resizeState.startX
  const deltaY = clientY - resizeState.startY
  const viewportLeft = OVERLAY_VIEWPORT_MARGIN
  const viewportTop = OVERLAY_VIEWPORT_MARGIN
  const viewportRight = viewportWidth - OVERLAY_VIEWPORT_MARGIN
  const viewportBottom = viewportHeight - OVERLAY_VIEWPORT_MARGIN
  const availableWidth = Math.max(1, viewportRight - viewportLeft)
  const availableHeight = Math.max(1, viewportBottom - viewportTop)
  const minWidth = Math.min(TIMER_OVERLAY_MIN_WIDTH, availableWidth)
  const minHeight = Math.min(TIMER_OVERLAY_MIN_HEIGHT, availableHeight)
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

function rankEntry(entry: GlobalTimerRegistration) {
  if (entry.isRouteActive) {
    if (entry.timer.status === 'running' || entry.timer.status === 'paused') return 4
  }
  if (entry.timer.startedAt && entry.timer.status !== 'completed') {
    if (entry.timer.status === 'running') return 3
    if (entry.timer.status === 'paused') return 2
  }
  if (entry.isRouteActive && entry.timer.status === 'idle') return 1
  return 0
}

export function selectActiveTimerEntry(entries: GlobalTimerRegistration[]) {
  const ranked = entries
    .map((entry) => ({ entry, rank: rankEntry(entry) }))
    .filter((candidate) => candidate.rank > 0)
    .sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank
      if (right.entry.isRouteActive !== left.entry.isRouteActive) {
        return right.entry.isRouteActive ? 1 : -1
      }
      if (right.entry.becameActiveAt !== left.entry.becameActiveAt) {
        return right.entry.becameActiveAt - left.entry.becameActiveAt
      }
      return right.entry.timer.effectiveSeconds - left.entry.timer.effectiveSeconds
    })
  return ranked[0]?.entry ?? null
}
