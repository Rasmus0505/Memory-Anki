import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { FreestyleCard } from '@/shared/api/contracts'
import { isFreestyleCompleteSlot } from '@/modules/practice/ui/freestyle/model/roundCompletion'

interface FeedScrollSettleDeps {
  scrollRef: RefObject<HTMLElement | null>
  queueRef: RefObject<FreestyleCard[]>
  programmaticScrollRef: RefObject<boolean>
  touchPointersRef: RefObject<number>
  userScrollingRef: RefObject<boolean>
  visualIndexRef: RefObject<number>
  currentIndexRef: RefObject<number>
  roundCompleteRef: RefObject<boolean>
  pageHeightRef: RefObject<number>
  hasUserScrollIntent: () => boolean
  flushDeferredRestudy: () => number
  markSettled: (index: number, announce: boolean) => void
  navigateToIndex: (
    index: number,
    options?: { scroll?: boolean; reorderRestudy?: boolean },
  ) => void
  scrollToIndex: (index: number, behavior?: 'animated' | 'auto') => void
  setVisualIndex: (index: number) => void
}

/**
 * Trailing settle after a scroll gesture (or a layout snap).
 *
 * A gesture the learner made commits the page it landed on. Anything else — the
 * browser re-snapping after a rating re-render, a late realign — only restores
 * the committed card: turning that drift into a page turn used to write a new
 * `set_cursor`, re-render the feed and drift again, walking the learner forward.
 */
export function useFreestyleFeedScrollSettle(deps: FeedScrollSettleDeps) {
  const {
    scrollRef,
    queueRef,
    programmaticScrollRef,
    touchPointersRef,
    userScrollingRef,
    visualIndexRef,
    currentIndexRef,
    roundCompleteRef,
    pageHeightRef,
    hasUserScrollIntent,
    flushDeferredRestudy,
    markSettled,
    navigateToIndex,
    scrollToIndex,
    setVisualIndex,
  } = deps
  const scrollIdleTimerRef = useRef<number | null>(null)
  const settleWhileTouchingRef = useRef<() => void>(() => {})
  const rescheduleSettleRef = useRef<(() => void) | null>(null)

  /**
   * After finger/wheel inertia ends: apply deferred restudy placement, then pin
   * the card still under the viewport by id. Never advances past that card.
   */
  const flushScrollSettled = useCallback(() => {
    userScrollingRef.current = false
    // A gesture that began inside the 50ms programmatic window must not be
    // swallowed: re-check once that flag has been released.
    if (programmaticScrollRef.current) {
      rescheduleSettleRef.current?.()
      return
    }
    const visual = visualIndexRef.current
    const listLength = queueRef.current.length
    if (!hasUserScrollIntent()) {
      // No finger/wheel moved this page: restore the committed view, not a new
      // cursor. The waiting/settlement slot has no queue cursor of its own;
      // currentIndex still names the last card even after an explicit open.
      // handleScroll does not adopt native drift into visualIndex without intent.
      const committed = isFreestyleCompleteSlot(visual, listLength, roundCompleteRef.current)
        ? listLength
        : Math.max(0, Math.min(currentIndexRef.current, Math.max(0, listLength - 1)))
      visualIndexRef.current = committed
      setVisualIndex(committed)
      const node = scrollRef.current
      const pageHeight = pageHeightRef.current || node?.clientHeight || 0
      if (!node || !pageHeight) return
      if (Math.abs(node.scrollTop - committed * pageHeight) > 2) {
        scrollToIndex(committed, 'auto')
      }
      return
    }
    if (isFreestyleCompleteSlot(visual, listLength, roundCompleteRef.current)) {
      const pinned = listLength
      visualIndexRef.current = pinned
      setVisualIndex(pinned)
      markSettled(pinned, true)
      const completeNode = scrollRef.current
      const completePageHeight = pageHeightRef.current || completeNode?.clientHeight || 0
      if (!completeNode || !completePageHeight) return
      const completeTop = pinned * completePageHeight
      if (Math.abs(completeNode.scrollTop - completeTop) > 2) {
        scrollToIndex(pinned, 'auto')
      }
      return
    }
    if (visual !== currentIndexRef.current) {
      navigateToIndex(visual, { scroll: false, reorderRestudy: false })
    }
    const pinned = flushDeferredRestudy()
    setVisualIndex(pinned)
    visualIndexRef.current = pinned
    markSettled(pinned, true)
    const node = scrollRef.current
    const pageHeight = pageHeightRef.current || node?.clientHeight || 0
    if (!node || !pageHeight) return
    const expectedTop = pinned * pageHeight
    if (Math.abs(node.scrollTop - expectedTop) > 2) {
      scrollToIndex(pinned, 'auto')
    }
  }, [
    currentIndexRef,
    flushDeferredRestudy,
    hasUserScrollIntent,
    markSettled,
    navigateToIndex,
    pageHeightRef,
    programmaticScrollRef,
    queueRef,
    roundCompleteRef,
    scrollRef,
    scrollToIndex,
    setVisualIndex,
    userScrollingRef,
    visualIndexRef,
  ])

  const scheduleScrollSettle = useCallback(() => {
    if (scrollIdleTimerRef.current != null) {
      window.clearTimeout(scrollIdleTimerRef.current)
    }
    // One trailing settle for both `scroll` and `scrollend`. iOS can fire
    // `scrollend` before snap finishes; flushing there announces the wrong card
    // and the real landing is then swallowed by the page-turn rate limit.
    scrollIdleTimerRef.current = window.setTimeout(() => {
      scrollIdleTimerRef.current = null
      if (touchPointersRef.current > 0) {
        settleWhileTouchingRef.current()
        return
      }
      flushScrollSettled()
    }, 90)
  }, [flushScrollSettled, touchPointersRef])
  settleWhileTouchingRef.current = scheduleScrollSettle
  rescheduleSettleRef.current = scheduleScrollSettle

  useEffect(() => () => {
    if (scrollIdleTimerRef.current != null) {
      window.clearTimeout(scrollIdleTimerRef.current)
    }
  }, [])

  return { scheduleScrollSettle }
}
