import { useEffect, useRef, type RefObject } from 'react'

export type AxisLock = 'pending' | 'page' | 'map'

export const AXIS_LOCK_SLOP_PX = 8
/** |dx| > |dy| * ratio → map. 0.75 ≈ 53° from vertical, so diagonals pan the map. */
export const AXIS_LOCK_MAP_RATIO = 0.75
const CLICK_SUPPRESS_MS = 400

export function resolveAxisLock(dx: number, dy: number): AxisLock {
  if (Math.hypot(dx, dy) < AXIS_LOCK_SLOP_PX) return 'pending'
  return Math.abs(dx) > Math.abs(dy) * AXIS_LOCK_MAP_RATIO ? 'map' : 'page'
}

const NO_PAN_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.nopan',
  '[data-text-mode="true"] .mindmap-node-text',
  '[data-english-mode="true"] .mindmap-node-text',
].join(',')

interface AxisLockedPanOptions {
  enabled: boolean
  /** Node drag owns single-finger drags that start on a node. */
  nodesDraggable: boolean
  onPan: (dx: number, dy: number) => void
  onPanEnd: () => void
}

/**
 * One-finger axis lock for a map embedded in a vertical scroller. Vertical swipes
 * stay native (the parent pages); horizontal or diagonal swipes pan the map.
 * Touch events (not pointer events) so the first map-locked touchmove can
 * preventDefault before the browser commits to scrolling.
 */
export function useAxisLockedPan(target: RefObject<HTMLElement | null>, options: AxisLockedPanOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const element = target.current
    if (!element || !options.enabled) return

    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    let lock: AxisLock | null = null
    let pendingDx = 0
    let pendingDy = 0
    let frame: number | null = null
    let panned = false
    let suppressClickUntil = 0

    const flush = () => {
      frame = null
      if (pendingDx === 0 && pendingDy === 0) return
      const dx = pendingDx
      const dy = pendingDy
      pendingDx = 0
      pendingDy = 0
      optionsRef.current.onPan(dx, dy)
    }

    const reset = () => {
      lock = null
      if (frame != null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      pendingDx = 0
      pendingDy = 0
    }

    const finish = () => {
      if (lock === 'map' && panned) {
        if (frame != null) cancelAnimationFrame(frame)
        flush()
        optionsRef.current.onPanEnd()
        suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS
      }
      panned = false
      reset()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        // A second finger hands the gesture to pinch; end any map pan cleanly.
        finish()
        return
      }
      const touchTarget = event.target instanceof Element ? event.target : null
      if (touchTarget?.closest(NO_PAN_SELECTOR)) return
      if (optionsRef.current.nodesDraggable && touchTarget?.closest('.react-flow__node')) return
      const touch = event.touches[0]
      startX = lastX = touch.clientX
      startY = lastY = touch.clientY
      lock = 'pending'
      panned = false
    }

    const onTouchMove = (event: TouchEvent) => {
      if (lock == null || lock === 'page') return
      if (event.touches.length !== 1) {
        finish()
        return
      }
      const touch = event.touches[0]
      if (lock === 'pending') {
        const next = resolveAxisLock(touch.clientX - startX, touch.clientY - startY)
        if (next === 'pending') return
        lock = next
        if (lock === 'page') return
        // Include the slop travel so the map starts exactly under the finger.
        lastX = startX
        lastY = startY
      }
      if (event.cancelable) event.preventDefault()
      pendingDx += touch.clientX - lastX
      pendingDy += touch.clientY - lastY
      lastX = touch.clientX
      lastY = touch.clientY
      panned = true
      if (frame == null) frame = requestAnimationFrame(flush)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (Date.now() > suppressClickUntil) return
      suppressClickUntil = 0
      event.preventDefault()
      event.stopPropagation()
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', finish)
    element.addEventListener('touchcancel', finish)
    element.addEventListener('click', onClickCapture, true)
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', finish)
      element.removeEventListener('touchcancel', finish)
      element.removeEventListener('click', onClickCapture, true)
      reset()
    }
  }, [options.enabled, target])
}
