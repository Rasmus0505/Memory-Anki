import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * How long a wheel/pointer gesture still counts as the learner turning the feed.
 * Covers momentum scroll after the finger lifts without letting a later layout
 * reflow masquerade as a page turn.
 */
export const USER_SCROLL_INTENT_MS = 1_200

/** Tapping one of these is not a page gesture, even though it sits in the feed. */
const FEED_CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="button"], [role="slider"]'

/**
 * Tracks whether a scroll came from the learner.
 *
 * A scroll event alone is not proof of a page turn: a rating ack re-renders the
 * feed, and a reflow / native snap can shift `scrollTop` by a page with nobody
 * touching the screen. Only a recent finger, pen or wheel gesture may turn the
 * feed; the settle puts every other drift back on the committed card.
 */
export function useFreestyleFeedScrollIntent({
  scrollRef,
  touchPointersRef,
  attachKey,
}: {
  scrollRef: RefObject<HTMLElement | null>
  /** Touch/pen pointers currently down; a slow drag keeps the gesture alive. */
  touchPointersRef: RefObject<number>
  /** Re-attach when the scroller may have (re)mounted. */
  attachKey: unknown
}) {
  const lastIntentAtRef = useRef(0)
  const mark = useCallback(() => {
    lastIntentAtRef.current = Date.now()
  }, [])
  const has = useCallback(() => (
    touchPointersRef.current > 0
    || (lastIntentAtRef.current > 0
      && Date.now() - lastIntentAtRef.current < USER_SCROLL_INTENT_MS)
  ), [touchPointersRef])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      const target = event.target
      if (target instanceof Element && target.closest(FEED_CONTROL_SELECTOR)) return
      mark()
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      if (touchPointersRef.current === 0) return
      mark()
    }
    const onWheel = (event: Event) => {
      // The review map consumes its wheel; it must not count as feed paging.
      const target = event.target
      if (target instanceof Element && target.closest('.react-flow')) return
      mark()
    }
    node.addEventListener('pointerdown', onPointerDown)
    node.addEventListener('pointermove', onPointerMove)
    node.addEventListener('wheel', onWheel, { passive: true })
    node.addEventListener('touchmove', onWheel, { passive: true })
    return () => {
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('pointermove', onPointerMove)
      node.removeEventListener('wheel', onWheel)
      node.removeEventListener('touchmove', onWheel)
    }
  }, [attachKey, mark, scrollRef, touchPointersRef])

  return { mark, has }
}
