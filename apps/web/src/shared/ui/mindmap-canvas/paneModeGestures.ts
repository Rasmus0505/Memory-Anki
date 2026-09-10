import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
} from './nodeCardModel'

export const PANE_DOUBLE_CLICK_WINDOW_MS = 350

const BLOCKED_PANE_GESTURE_SELECTOR = [
  '.react-flow__node',
  '.react-flow__edge',
  '.react-flow__controls',
  '.react-flow__minimap',
  '.mindmap-node',
].join(', ')

const PANE_GESTURE_SELECTOR = '.react-flow__pane, .react-flow__background'

export function isMindMapPaneTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  if (!element) return false
  if (element.closest(BLOCKED_PANE_GESTURE_SELECTOR)) return false
  return Boolean(element.closest(PANE_GESTURE_SELECTOR))
}

export interface PaneModeGesturePoint {
  pointerId: number
  x: number
  y: number
}

export interface PaneModeGestureDown extends PaneModeGesturePoint {
  isPrimary: boolean
  isPane: boolean
}

export interface PaneModeGestureUp extends PaneModeGesturePoint {
  isPane: boolean
}

interface PaneModeGestureMachineOptions {
  getOnDoubleClick?: () => (() => void) | undefined
  getOnLongPress?: () => (() => void) | undefined
  now?: () => number
  setTimeoutFn?: (callback: () => void, delayMs: number) => number
  clearTimeoutFn?: (id: number) => void
  doubleClickWindowMs?: number
  longPressDelayMs?: number
  moveTolerancePx?: number
}

interface ActivePaneHold {
  pointerId: number
  x: number
  y: number
  timerId: number | null
  moved: boolean
  longPressFired: boolean
}

/**
 * Pane-only double-tap / long-press. Pointer movement beyond the node-card
 * tolerance cancels the hold; we do not listen to React Flow onMoveStart
 * because d3-zoom can fire that on pane pointerdown.
 */
export function createPaneModeGestureMachine(options: PaneModeGestureMachineOptions = {}) {
  const now = options.now ?? Date.now
  const setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => window.setTimeout(callback, delayMs))
  const clearTimeoutFn = options.clearTimeoutFn ?? ((id) => window.clearTimeout(id))
  const doubleClickWindowMs = options.doubleClickWindowMs ?? PANE_DOUBLE_CLICK_WINDOW_MS
  const longPressDelayMs = options.longPressDelayMs ?? LONG_PRESS_DELAY_MS
  const moveTolerancePx = options.moveTolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX

  let hold: ActivePaneHold | null = null
  let lastTap: { x: number; y: number; at: number } | null = null

  const clearTimer = () => {
    if (hold?.timerId == null) return
    clearTimeoutFn(hold.timerId)
    hold.timerId = null
  }

  const abortHold = () => {
    clearTimer()
    hold = null
  }

  const pointerDown = (input: PaneModeGestureDown) => {
    if (!input.isPrimary) return
    if (!input.isPane) {
      lastTap = null
      abortHold()
      return
    }
    abortHold()
    const nextHold: ActivePaneHold = {
      pointerId: input.pointerId,
      x: input.x,
      y: input.y,
      timerId: null,
      moved: false,
      longPressFired: false,
    }
    hold = nextHold
    if (!options.getOnLongPress?.()) return
    nextHold.timerId = setTimeoutFn(() => {
      if (hold !== nextHold) return
      nextHold.timerId = null
      nextHold.longPressFired = true
      lastTap = null
      options.getOnLongPress?.()?.()
    }, longPressDelayMs)
  }

  const pointerMove = (input: PaneModeGesturePoint) => {
    if (!hold || input.pointerId !== hold.pointerId || hold.longPressFired) return
    const distance = Math.hypot(input.x - hold.x, input.y - hold.y)
    if (distance <= moveTolerancePx) return
    hold.moved = true
    clearTimer()
  }

  const pointerUp = (input: PaneModeGestureUp) => {
    if (!hold || input.pointerId !== hold.pointerId) return
    const { moved, longPressFired, x, y } = hold
    abortHold()
    if (longPressFired || moved) return
    const onDoubleClick = options.getOnDoubleClick?.()
    if (!onDoubleClick || !input.isPane) {
      if (!input.isPane) lastTap = null
      return
    }
    const at = now()
    if (
      lastTap
      && at - lastTap.at <= doubleClickWindowMs
      && Math.hypot(input.x - lastTap.x, input.y - lastTap.y) <= moveTolerancePx
    ) {
      lastTap = null
      onDoubleClick()
      return
    }
    lastTap = { x: input.x ?? x, y: input.y ?? y, at }
  }

  const pointerCancel = (input: Pick<PaneModeGesturePoint, 'pointerId'>) => {
    if (!hold || input.pointerId !== hold.pointerId) return
    lastTap = null
    abortHold()
  }

  const dispose = () => {
    abortHold()
    lastTap = null
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    dispose,
  }
}
