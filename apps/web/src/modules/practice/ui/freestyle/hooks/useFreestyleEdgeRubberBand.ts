import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { triggerHaptic } from '@/shared/feedback/haptics'

export type FeedEdge = 'top' | 'bottom'

const MAX_STRETCH_PX = 120
const HINT_THRESHOLD_PX = 36
const HINT_VISIBLE_MS = 1400
const WHEEL_RELEASE_MS = 140
const AXIS_LOCK_PX = 8

/** iOS-style diminishing stretch: grows ever slower toward MAX_STRETCH_PX. */
export function rubberBand(offset: number, limit = MAX_STRETCH_PX) {
  const sign = Math.sign(offset)
  const magnitude = Math.abs(offset)
  return sign * (1 - 1 / ((magnitude * 0.55) / limit + 1)) * limit
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function edgePage(scroller: HTMLElement, edge: FeedEdge) {
  const pages = scroller.querySelectorAll<HTMLElement>(':scope > .fs-page')
  return edge === 'top' ? pages[0] ?? null : pages[pages.length - 1] ?? null
}

function atEdge(scroller: HTMLElement, edge: FeedEdge) {
  if (edge === 'top') return scroller.scrollTop <= 1
  return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
}

/**
 * Overscroll feedback for the feed's first/last page. The scroller uses
 * `overscroll-behavior: none`, so the only stretch the learner sees is this one on
 * every platform (native iOS bounce would otherwise double it on the phone only).
 */
export function useFreestyleEdgeRubberBand(
  scrollRef: RefObject<HTMLElement | null>,
  /** Changes when the scroller may have (re)mounted, so listeners re-attach. */
  attachKey: unknown,
) {
  const [hint, setHint] = useState<{ edge: FeedEdge; nonce: number } | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  const hintShownRef = useRef(false)

  const showHint = useCallback((edge: FeedEdge) => {
    if (hintShownRef.current) return
    hintShownRef.current = true
    triggerHaptic('select')
    setHint((current) => ({ edge, nonce: (current?.nonce ?? 0) + 1 }))
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setHint(null)
    }, HINT_VISIBLE_MS)
  }, [])

  const release = useCallback((page: HTMLElement | null, fromPx: number) => {
    hintShownRef.current = false
    if (!page) return
    page.style.transform = ''
    if (Math.abs(fromPx) < 0.5 || typeof page.animate !== 'function') return
    page.animate(
      [{ transform: `translate3d(0, ${fromPx}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: 520, easing: 'cubic-bezier(0.22, 1.25, 0.36, 1)' },
    )
  }, [])

  /** Keyboard/button paging past an edge: a short bump instead of silence. */
  const nudge = useCallback((edge: FeedEdge) => {
    const scroller = scrollRef.current
    if (!scroller) return
    showHint(edge)
    hintShownRef.current = false
    const page = edgePage(scroller, edge)
    if (!page || prefersReducedMotion() || typeof page.animate !== 'function') return
    const bump = edge === 'top' ? 22 : -22
    page.animate(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: `translate3d(0, ${bump}px, 0)`, offset: 0.35 },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.22, 1.1, 0.36, 1)' },
    )
  }, [scrollRef, showHint])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const reduced = prefersReducedMotion()
    let touch: { x: number; y: number; axis: 'x' | 'y' | null; edge: FeedEdge | null; offset: number } | null = null
    let wheel: { edge: FeedEdge; raw: number; timer: number } | null = null

    const apply = (edge: FeedEdge, offset: number) => {
      const page = edgePage(scroller, edge)
      if (!page) return
      if (!reduced) page.style.transform = `translate3d(0, ${offset}px, 0)`
      if (Math.abs(offset) >= HINT_THRESHOLD_PX || reduced) showHint(edge)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touch = null
        return
      }
      const point = event.touches[0]
      touch = { x: point.clientX, y: point.clientY, axis: null, edge: null, offset: 0 }
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return
      const point = event.touches[0]
      const dx = point.clientX - touch.x
      const dy = point.clientY - touch.y
      if (!touch.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return
        touch.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
        if (touch.axis === 'y') {
          if (dy > 0 && atEdge(scroller, 'top')) touch.edge = 'top'
          else if (dy < 0 && atEdge(scroller, 'bottom')) touch.edge = 'bottom'
        }
      }
      if (touch.axis !== 'y' || !touch.edge) return
      const pull = touch.edge === 'top' ? Math.max(0, dy) : Math.min(0, dy)
      touch.offset = rubberBand(pull)
      apply(touch.edge, touch.offset)
    }
    const onTouchEnd = () => {
      if (touch?.edge) release(edgePage(scroller, touch.edge), touch.offset)
      touch = null
    }

    const onWheel = (event: WheelEvent) => {
      // The feed pager preventDefaults wheel notches before they reach this bubble.
      if (event.defaultPrevented) return
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
      const edge: FeedEdge | null = event.deltaY < 0 && atEdge(scroller, 'top')
        ? 'top'
        : event.deltaY > 0 && atEdge(scroller, 'bottom') ? 'bottom' : null
      if (!edge) return
      if (!wheel || wheel.edge !== edge) {
        if (wheel) window.clearTimeout(wheel.timer)
        wheel = { edge, raw: 0, timer: 0 }
      }
      wheel.raw = Math.max(-400, Math.min(400, wheel.raw - event.deltaY * 0.6))
      const offset = rubberBand(wheel.raw)
      apply(edge, offset)
      window.clearTimeout(wheel.timer)
      wheel.timer = window.setTimeout(() => {
        if (!wheel) return
        release(edgePage(scroller, wheel.edge), offset)
        wheel = null
      }, WHEEL_RELEASE_MS)
    }

    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: true })
    scroller.addEventListener('touchend', onTouchEnd, { passive: true })
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true })
    scroller.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
      scroller.removeEventListener('wheel', onWheel)
      if (wheel) window.clearTimeout(wheel.timer)
    }
  }, [attachKey, release, scrollRef, showHint])

  useEffect(() => () => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
  }, [])

  return { edgeHint: hint, nudgeEdge: nudge }
}
