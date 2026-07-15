import type { CSSProperties } from 'react'
import type { TimedSessionController } from '@/shared/hooks/useTimedSession'
import type { TimerFocusScene } from '@/shared/components/session/timer-focus-config'
import {
  DEFAULT_TIMER_OVERLAY_LAYOUT,
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
  routePath: string
}

export const OVERLAY_VIEWPORT_MARGIN = 12
export const TIMER_DRAG_CLICK_THRESHOLD_PX = 6
export const TIMER_OVERLAY_BASE_WIDTH = DEFAULT_TIMER_OVERLAY_LAYOUT.width
export const TIMER_OVERLAY_BASE_HEIGHT = DEFAULT_TIMER_OVERLAY_LAYOUT.height

type TimerOverlayPanelStyle = CSSProperties & Record<`--${string}`, string>

export interface TimerOverlaySizeTokens {
  widthRatio: number
  heightRatio: number
  sizeRatio: number
  panelStyle: TimerOverlayPanelStyle
  iconButtonStyle: CSSProperties
  iconStyle: CSSProperties
  actionButtonStyle: CSSProperties
}

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

function migrateObstructiveDesktopTimerOverlayLayout(layout: TimerOverlayLayout) {
  if (typeof window === 'undefined' || window.innerWidth < 1024) return layout
  const isLegacyDefault =
    layout.x === 24 &&
    layout.y === 96 &&
    layout.width === 320 &&
    layout.height === 208 &&
    !layout.collapsed
  const isPreviousTopRightDefault =
    layout.x === window.innerWidth - layout.width - 24 &&
    layout.y === 24 &&
    layout.width === 320 &&
    layout.height === 208 &&
    !layout.collapsed
  if (!isLegacyDefault && !isPreviousTopRightDefault) return layout
  return {
    ...layout,
    x: window.innerWidth - layout.width - 24,
    y: window.innerHeight - layout.height - 24,
  }
}

export function resolveFloatingTimerLayout(layout: TimerOverlayLayout) {
  const sanitized = sanitizeTimerOverlayLayout(layout)
  return clampTimerOverlayLayoutToViewport(
    migrateObstructiveDesktopTimerOverlayLayout(sanitized),
  )
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function roundPx(value: number) {
  return `${Math.round(value)}px`
}

export function createTimerOverlaySizeTokens(layout: Pick<TimerOverlayLayout, 'width' | 'height'>): TimerOverlaySizeTokens {
  const widthRatio = layout.width / TIMER_OVERLAY_BASE_WIDTH
  const heightRatio = layout.height / TIMER_OVERLAY_BASE_HEIGHT
  const sizeRatio = Math.sqrt(widthRatio * heightRatio)
  const panelPadding = clampNumber(12 * sizeRatio, 9, 22)
  const panelRadius = clampNumber(28 * sizeRatio, 20, 42)
  const innerRadius = Math.max(16, panelRadius - 2)
  const dragGap = clampNumber(12 * sizeRatio, 8, 18)
  const dragbarMinHeight = clampNumber(32 * heightRatio, 26, 46)
  const sceneFontSize = clampNumber(11 * (0.55 * sizeRatio + 0.45 * widthRatio), 10, 16)
  const titleFontSize = clampNumber(11 * (0.48 * sizeRatio + 0.52 * widthRatio), 10, 15)
  const digitsFontSize = clampNumber(64 * (0.72 * widthRatio + 0.28 * heightRatio), 42, 108)
  const digitsMarginTop = clampNumber(2 * heightRatio, 0, 6)
  const rowFontSize = clampNumber(11 * (0.4 * widthRatio + 0.6 * heightRatio), 10, 15)
  const rowMinHeight = clampNumber(22 * heightRatio, 20, 34)
  const rowPaddingX = clampNumber(10 * widthRatio, 8, 18)
  const bodyGap = clampNumber(6 * heightRatio, 4, 12)
  const actionsGap = clampNumber(8 * widthRatio, 6, 14)
  const actionHeight = clampNumber(32 * heightRatio, 28, 46)
  const actionFontSize = clampNumber(12 * (0.42 * widthRatio + 0.58 * heightRatio), 11, 15)
  const iconButtonSize = clampNumber(32 * sizeRatio, 28, 42)
  const iconSize = clampNumber(16 * sizeRatio, 14, 22)
  const buttonRadius = clampNumber(10 * sizeRatio, 8, 16)

  return {
    widthRatio,
    heightRatio,
    sizeRatio,
    panelStyle: {
      '--timer-panel-padding': roundPx(panelPadding),
      '--timer-panel-radius': roundPx(panelRadius),
      '--timer-panel-inner-radius': roundPx(innerRadius),
      '--timer-dragbar-gap': roundPx(dragGap),
      '--timer-dragbar-min-height': roundPx(dragbarMinHeight),
      '--timer-scene-font-size': roundPx(sceneFontSize),
      '--timer-title-font-size': roundPx(titleFontSize),
      '--timer-digits-font-size': roundPx(digitsFontSize),
      '--timer-digits-margin-top': roundPx(digitsMarginTop),
      '--timer-row-font-size': roundPx(rowFontSize),
      '--timer-row-min-height': roundPx(rowMinHeight),
      '--timer-row-padding-x': roundPx(rowPaddingX),
      '--timer-body-gap': roundPx(bodyGap),
      '--timer-actions-gap': roundPx(actionsGap),
      '--timer-action-height': roundPx(actionHeight),
      '--timer-action-font-size': roundPx(actionFontSize),
      '--timer-button-radius': roundPx(buttonRadius),
    },
    iconButtonStyle: {
      width: roundPx(iconButtonSize),
      height: roundPx(iconButtonSize),
      minWidth: roundPx(iconButtonSize),
      borderRadius: roundPx(buttonRadius),
    },
    iconStyle: {
      width: roundPx(iconSize),
      height: roundPx(iconSize),
    },
    actionButtonStyle: {
      height: roundPx(actionHeight),
      fontSize: roundPx(actionFontSize),
      borderRadius: roundPx(buttonRadius),
    },
  }
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
