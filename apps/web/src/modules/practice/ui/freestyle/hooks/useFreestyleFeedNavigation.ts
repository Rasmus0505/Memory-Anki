import { themeMotion } from '@/shared/theme/themePacks'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from 'react'
import {
  canPopViewHistory,
  popViewHistory,
  pushViewHistory,
  visibleMountIndices,
} from '@/modules/practice/public'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import {
  clampFreestyleFeedIndex,
  findEarliestCompleteSeekIndex,
  freestyleFeedSlotCount,
  isFreestyleCompleteSlot,
  resolveFreestyleCompleteSeek,
} from '@/modules/practice/ui/freestyle/model/roundCompletion'
import {
  getFreestyleFeedPageDirection,
  getFreestyleQuestionDirection,
  isFreestyleShortcutBlocked,
  shouldSwallowFreestyleFeedPageKey,
} from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import type { FreestyleCard } from '@/shared/api/contracts'
import { animateScrollTop } from '@/modules/practice/ui/freestyle/model/freestyleAnimatedScroll'
import {
  createFreestyleScrollChannel,
  scrollFrameFromPosition,
} from '@/modules/practice/ui/freestyle/model/freestyleScrollChannel'
import { useFreestyleEdgeRubberBand } from '@/modules/practice/ui/freestyle/hooks/useFreestyleEdgeRubberBand'

function slotIndexOfKey(key: string, cardIds: readonly string[]) {
  if (key.startsWith('slot:')) return Number(key.slice(5))
  return cardIds.indexOf(key)
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>

/**
 * Snap-scroll paging for the immersive feed: the visual index (what is under the
 * viewport) is tracked apart from the queue index so a finger/wheel gesture is never
 * fought by a programmatic scrollTo, plus 上一张 history, keyboard paging and the
 * closing slot.
 */
export function useFreestyleFeedNavigation({
  cards,
  currentIndex,
  roundComplete,
  goToIndex,
  flushDeferredRestudy,
  pendingRestudyCardIds,
  queueRef,
  queueState,
  roundPlan,
  isActive,
  becameActiveAt,
  loading,
  queueFrozen,
  startupVisualIndex,
  onStartupVisualApplied,
  onPageTurn,
}: {
  cards: ImmersiveQueue['cards']
  currentIndex: number
  roundComplete: boolean
  goToIndex: ImmersiveQueue['goToIndex']
  flushDeferredRestudy: ImmersiveQueue['flushDeferredRestudy']
  pendingRestudyCardIds: ImmersiveQueue['pendingRestudyCardIds']
  queueRef: RefObject<FreestyleCard[]>
  queueState: ImmersiveQueue['queueState']
  roundPlan: ImmersiveQueue['roundPlan']
  isActive: boolean
  becameActiveAt: unknown
  loading: boolean
  queueFrozen: boolean
  /** Closing settlement slot to show once after a cold open. Null for a card target. */
  startupVisualIndex: number | null
  onStartupVisualApplied: () => void
  /** Fires once per page actually landed on (finger, wheel, keyboard or button). */
  onPageTurn?: (direction: 'forward' | 'backward') => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const programmaticScrollRef = useRef(false)
  /**
   * When set to an index, the next matching `currentIndex` effect will scrollTo.
   * Finger/wheel scroll only updates index and leaves this null so we never fight the gesture.
   */
  const requestedScrollIndexRef = useRef<number | null>(null)
  /** Cards left by button/keyboard/skip — used by 「上一张」 after restudy reorders. */
  const viewHistoryRef = useRef<string[]>([])
  const [canGoPrevious, setCanGoPrevious] = useState(false)
  /** Index updates from the scroller itself — layout realign must not fight the gesture. */
  const indexChangeFromScrollRef = useRef(false)
  /** True while the user is actively dragging/wheeling the feed. */
  const userScrollingRef = useRef(false)
  const scrollIdleTimerRef = useRef<number | null>(null)
  const pageHeightRef = useRef(0)
  const [visualIndex, setVisualIndex] = useState(0)
  const visualIndexRef = useRef(0)
  /** Read at auto-advance fire time so a settle-time reorder cannot turn the wrong page. */
  const currentIndexRef = useRef(0)
  const roundCompleteRef = useRef(false)
  const [readOnlyHistoryCardId, setReadOnlyHistoryCardId] = useState<string | null>(null)

  currentIndexRef.current = currentIndex
  visualIndexRef.current = visualIndex
  roundCompleteRef.current = roundComplete
  const viewingCompleteSlot = isFreestyleCompleteSlot(visualIndex, cards.length, roundComplete)

  const refreshCanGoPrevious = useCallback(
    (index = currentIndex, list = cards) => {
      const currentId = list[index]?.id ?? null
      const hasHistory = canPopViewHistory(viewHistoryRef.current, list, currentId)
      const hasIndexPrev = index > 0 && list.length > 0
      setCanGoPrevious(hasHistory || hasIndexPrev)
    },
    [cards, currentIndex],
  )

  useEffect(() => {
    refreshCanGoPrevious(visualIndex)
  }, [refreshCanGoPrevious, visualIndex])

  useEffect(() => {
    if (userScrollingRef.current) return
    if (roundComplete && cards.length > 0 && visualIndexRef.current >= cards.length) {
      const completeIndex = cards.length
      visualIndexRef.current = completeIndex
      setVisualIndex(completeIndex)
      return
    }
    setVisualIndex(currentIndex)
    visualIndexRef.current = currentIndex
  }, [cards.length, currentIndex, roundComplete])

  const [scrollChannel] = useState(createFreestyleScrollChannel)
  const cardIds = useMemo(() => cards.map((card) => card.id), [cards])
  const cardIdsRef = useRef(cardIds)
  cardIdsRef.current = cardIds
  const onPageTurnRef = useRef(onPageTurn)
  onPageTurnRef.current = onPageTurn
  /** Identity of the last page the learner landed on: card id, or `slot:N` for the closing slot. */
  const settledKeyRef = useRef<string | null>(null)
  const cancelScrollAnimationRef = useRef<(() => void) | null>(null)
  const { edgeHint, nudgeEdge } = useFreestyleEdgeRubberBand(scrollRef, `${loading}:${cards.length}`)

  const slotKey = useCallback((index: number) => cardIdsRef.current[index] ?? `slot:${index}`, [])

  /**
   * Record the landed page. `announce` plays the page-turn cue when the identity changed;
   * silent realigns (restore, reorder correction) only move the baseline.
   */
  const markSettled = useCallback((index: number, announce: boolean) => {
    const ids = cardIdsRef.current
    scrollChannel.publish(scrollFrameFromPosition(index, ids, true))
    const key = slotKey(index)
    const previous = settledKeyRef.current
    settledKeyRef.current = key
    if (!announce || previous == null || previous === key) return
    const from = slotIndexOfKey(previous, ids)
    onPageTurnRef.current?.(from >= 0 && index < from ? 'backward' : 'forward')
  }, [scrollChannel, slotKey])

  useEffect(() => {
    if (settledKeyRef.current == null && cards.length > 0) {
      settledKeyRef.current = slotKey(visualIndexRef.current)
    }
  }, [cards.length, slotKey])

  /**
   * `animated` = button/keyboard paging (eased flight, then the page-turn cue).
   * `auto` = silent realign for restore/reorder/settle correction.
   */
  const scrollToIndex = useCallback(
    (index: number, behavior: 'animated' | 'auto' = 'animated') => {
      const node = scrollRef.current
      if (!node || !node.clientHeight) return
      cancelScrollAnimationRef.current?.()
      cancelScrollAnimationRef.current = null
      const pageHeight = node.clientHeight
      const targetTop = index * pageHeight
      programmaticScrollRef.current = true
      const release = (delayMs: number) => {
        window.setTimeout(() => {
          if (cancelScrollAnimationRef.current == null) programmaticScrollRef.current = false
        }, delayMs)
      }
      const distance = Math.abs(targetTop - node.scrollTop)
      if (behavior === 'auto' || prefersReducedMotion() || distance < 2) {
        node.scrollTo({ top: targetTop, behavior: 'auto' })
        markSettled(index, behavior === 'animated')
        release(50)
        return
      }
      // Long jumps (complete-seek, history): only ±2 pages are mounted, so land one
      // page short instantly and fly the last page instead of crossing placeholders.
      if (distance > pageHeight * 2.5) {
        node.scrollTop = targetTop - Math.sign(targetTop - node.scrollTop) * pageHeight
      }
      cancelScrollAnimationRef.current = animateScrollTop(node, targetTop, {
        durationMs: themeMotion().pageTurnMs,
        onFinish: (completed) => {
          cancelScrollAnimationRef.current = null
          if (completed) {
            markSettled(index, true)
            release(50)
          } else {
            // The finger took over mid-flight; native scroll + settle own it from here.
            programmaticScrollRef.current = false
          }
        },
      })
    },
    [markSettled],
  )

  useEffect(() => () => cancelScrollAnimationRef.current?.(), [])

  /**
   * Navigate the feed index. Programmatic scroll only when `scroll` is true
   * (keyboard / 上一张 / 下一张 / 下个宫殿). Finger/wheel scroll only updates index —
   * never fights the gesture with a second scrollTo / snap takeover.
   */
  const navigateToIndex = useCallback(
    (
      index: number,
      options?: {
        scroll?: boolean
        /** Default true for buttons; false while the scroller owns the gesture. */
        reorderRestudy?: boolean
        /** When true, do not push the leaving card into view history (used by 上一张). */
        skipHistory?: boolean
        /** Dedicated history recap: closed encounter, no new session. In-round 上一张 is not this. */
        historical?: boolean
      },
    ) => {
      const next = clampFreestyleFeedIndex(index, cards.length, roundComplete)
      const fromScroll = options?.scroll === false
      if (isFreestyleCompleteSlot(next, cards.length, roundComplete)) {
        setReadOnlyHistoryCardId(null)
        if (!options?.skipHistory && next > currentIndex) {
          const leavingId = cards[currentIndex]?.id
          if (leavingId) {
            viewHistoryRef.current = pushViewHistory(viewHistoryRef.current, leavingId)
          }
        }
        if (fromScroll) {
          indexChangeFromScrollRef.current = true
        } else {
          scrollToIndex(next)
        }
        visualIndexRef.current = next
        setVisualIndex(next)
        refreshCanGoPrevious(next)
        return
      }
      const targetCardId = cards[next]?.id ?? null
      setReadOnlyHistoryCardId(options?.historical ? targetCardId : null)
      if (fromScroll) {
        indexChangeFromScrollRef.current = true
        // Finger/wheel leave still needs history so 「上一张」works after restudy
        // reorders the feed (next unit can land at index 0).
        if (!options?.skipHistory && next > currentIndex) {
          const leavingId = cards[currentIndex]?.id
          if (leavingId) {
            viewHistoryRef.current = pushViewHistory(viewHistoryRef.current, leavingId)
          }
        }
        goToIndex(next, { reorderRestudy: options?.reorderRestudy === true ? true : false })
        visualIndexRef.current = next
        setVisualIndex(next)
        refreshCanGoPrevious(next)
        return
      }
      // Same index: React may bail out of setState; still align the viewport.
      // Leaving the closing slot also lands here because queue index never moved.
      if (next === currentIndex) {
        visualIndexRef.current = next
        setVisualIndex(next)
        scrollToIndex(next)
        refreshCanGoPrevious(next)
        return
      }
      if (!options?.skipHistory && next > currentIndex) {
        const leavingId = cards[currentIndex]?.id
        if (leavingId) {
          viewHistoryRef.current = pushViewHistory(viewHistoryRef.current, leavingId)
        }
      }
      requestedScrollIndexRef.current = next
      const applied = goToIndex(next, {
        reorderRestudy: options?.reorderRestudy !== false,
      })
      // Restudy reordering can shift the target index; keep scroll request in sync.
      if (typeof applied === 'number') {
        requestedScrollIndexRef.current = applied
      }
      refreshCanGoPrevious(typeof applied === 'number' ? applied : next)
    },
    // getIncompleteUnitSummary is intentionally absent: the hint moved onto the card
    // (see sequentialBlockedHint), so this callback no longer reads it.
    [cards, currentIndex, goToIndex, refreshCanGoPrevious, roundComplete, scrollToIndex],
  )

  /**
   * 「上一张」: prefer view history so restudy/skip reorders still return to the
   * unit just left (even when that unit is no longer at index-1, or when the next
   * unit slid into index 0 and index-based back would stay disabled).
   */
  const navigatePrevious = useCallback(() => {
    if (isFreestyleCompleteSlot(visualIndexRef.current, cards.length, roundComplete)) {
      navigateToIndex(Math.max(0, cards.length - 1), { skipHistory: true })
      return
    }
    const list = cards
    const currentId = list[currentIndex]?.id ?? null
    const popped = popViewHistory(viewHistoryRef.current, list, currentId)
    if (popped) {
      viewHistoryRef.current = popped.history
      const targetIndex = list.findIndex((card) => card.id === popped.targetId)
      if (targetIndex >= 0) {
        navigateToIndex(targetIndex, { skipHistory: true })
        return
      }
    }
    if (currentIndex > 0) {
      navigateToIndex(currentIndex - 1, { skipHistory: true })
      return
    }
    nudgeEdge('top')
  }, [cards, currentIndex, navigateToIndex, nudgeEdge, roundComplete])

  const navigateNext = useCallback(() => {
    if (isFreestyleCompleteSlot(visualIndexRef.current, cards.length, roundComplete)) {
      nudgeEdge('bottom')
      return
    }
    const from = visualIndexRef.current
    const currentId = cards[from]?.id ?? null
    const pendingOnCurrent = Boolean(
      currentId && pendingRestudyCardIds.includes(currentId),
    )
    // Last card still holding an uninserted retry: leave/insert then land on it.
    if (from >= cards.length - 1 && pendingOnCurrent) {
      if (currentId) {
        viewHistoryRef.current = pushViewHistory(viewHistoryRef.current, currentId)
      }
      const applied = goToIndex(from + 1, { reorderRestudy: true })
      const landed = typeof applied === 'number' ? applied : from
      requestedScrollIndexRef.current = landed
      visualIndexRef.current = landed
      setVisualIndex(landed)
      refreshCanGoPrevious(landed)
      return
    }
    if (clampFreestyleFeedIndex(from + 1, cards.length, roundComplete) === from) nudgeEdge('bottom')
    navigateToIndex(from + 1)
  }, [
    cards,
    goToIndex,
    navigateToIndex,
    nudgeEdge,
    pendingRestudyCardIds,
    refreshCanGoPrevious,
    roundComplete,
  ])

  useEffect(() => {
    if (requestedScrollIndexRef.current !== currentIndex) return
    requestedScrollIndexRef.current = null
    scrollToIndex(currentIndex)
  }, [currentIndex, scrollToIndex])

  useEffect(() => {
    const handleQuestionNavigation = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) return
      const direction = getFreestyleQuestionDirection(event.key)
      if (!direction) return
      event.preventDefault()
      if (direction === 'previous') {
        navigatePrevious()
        return
      }
      navigateNext()
    }
    window.addEventListener('keydown', handleQuestionNavigation, true)
    return () => window.removeEventListener('keydown', handleQuestionNavigation, true)
  }, [navigateNext, navigatePrevious])

  /**
   * After finger/wheel inertia ends: apply deferred restudy placement, then pin
   * the card still under the viewport by id. Never advances past that card.
   */
  const flushScrollSettled = useCallback(() => {
    userScrollingRef.current = false
    if (programmaticScrollRef.current) return
    const visual = visualIndexRef.current
    const listLength = queueRef.current.length
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
  }, [flushDeferredRestudy, markSettled, navigateToIndex, queueRef, scrollToIndex])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const updatePageHeight = () => {
      pageHeightRef.current = node.clientHeight
      // The depth stack's pinned counter-translate must equal exactly one page.
      node.style.setProperty('--fs-page-h', `${node.clientHeight}px`)
    }
    updatePageHeight()
    const observer = new ResizeObserver(updatePageHeight)
    observer.observe(node)
    window.visualViewport?.addEventListener('resize', updatePageHeight)
    return () => {
      observer.disconnect()
      window.visualViewport?.removeEventListener('resize', updatePageHeight)
    }
  }, [loading, cards.length])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScrollEnd = () => {
      if (scrollIdleTimerRef.current != null) {
        window.clearTimeout(scrollIdleTimerRef.current)
        scrollIdleTimerRef.current = null
      }
      flushScrollSettled()
    }
    node.addEventListener('scrollend', onScrollEnd)
    return () => {
      node.removeEventListener('scrollend', onScrollEnd)
    }
  }, [flushScrollSettled, cards.length, loading])

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current != null) {
        window.clearTimeout(scrollIdleTimerRef.current)
      }
    }
  }, [])

  /**
   * Cold open can land on the closing settlement slot, which is not a queue
   * index. Scroll there once, then let the realign effect own the viewport.
   */
  useLayoutEffect(() => {
    if (startupVisualIndex == null) return
    if (!isActive || loading || queueFrozen || cards.length === 0) return
    const node = scrollRef.current
    if (!node?.clientHeight) return
    const target = roundComplete && startupVisualIndex >= cards.length
      ? cards.length
      : Math.max(0, Math.min(startupVisualIndex, Math.max(0, cards.length - 1)))
    scrollToIndex(target, 'auto')
    visualIndexRef.current = target
    setVisualIndex(target)
    onStartupVisualApplied()
  }, [
    cards.length,
    isActive,
    loading,
    onStartupVisualApplied,
    queueFrozen,
    roundComplete,
    scrollToIndex,
    startupVisualIndex,
  ])

  /**
   * Route residency hides inactive pages with `display: none`, which resets
   * scrollTop to 0. Remounts also start at the top. Re-align for route, load,
   * and index identity — never while the user is scrolling.
   */
  useLayoutEffect(() => {
    if (startupVisualIndex != null) return
    if (!isActive || loading || cards.length === 0) return
    if (queueFrozen) return
    if (userScrollingRef.current || programmaticScrollRef.current) return
    if (indexChangeFromScrollRef.current) {
      indexChangeFromScrollRef.current = false
      return
    }
    // Layout effects run before the requested-scroll effect: an instant realign here
    // would teleport to the target and leave the animated flight nothing to animate.
    if (requestedScrollIndexRef.current === currentIndex) return
    const node = scrollRef.current
    if (!node?.clientHeight) return
    const viewingComplete = isFreestyleCompleteSlot(
      visualIndexRef.current,
      cards.length,
      roundComplete,
    )
    const targetIndex = viewingComplete ? cards.length : currentIndex
    const expectedTop = targetIndex * node.clientHeight
    if (Math.abs(node.scrollTop - expectedTop) < 2) return
    scrollToIndex(targetIndex, 'auto')
  }, [
    isActive,
    becameActiveAt,
    loading,
    currentIndex,
    queueFrozen,
    roundComplete,
    scrollToIndex,
    startupVisualIndex,
    // cards.length only gates the early return; silent rebuilds must not re-scroll.
    cards.length,
  ])

  useEffect(() => {
    const handlePageShow = () => {
      if (!isActive || loading || userScrollingRef.current) return
      scrollToIndex(visualIndexRef.current, 'auto')
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [isActive, loading, scrollToIndex])

  const mounted = useMemo(
    () => visibleMountIndices(visualIndex, cards.length),
    [cards.length, visualIndex],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      const pageHeight = pageHeightRef.current || element.clientHeight
      // Published for programmatic flights too, so the rail follows keyboard paging.
      if (pageHeight && cards.length > 0) {
        scrollChannel.publish(scrollFrameFromPosition(element.scrollTop / pageHeight, cardIdsRef.current, false))
      }
      if (programmaticScrollRef.current) return
      if (!pageHeight || cards.length === 0) return
      userScrollingRef.current = true
      const nextIndex = Math.max(
        0,
        Math.min(
          Math.max(0, freestyleFeedSlotCount(cards.length, roundComplete) - 1),
          Math.round(element.scrollTop / pageHeight),
        ),
      )
      if (nextIndex !== visualIndexRef.current) {
        // Visual index only — do not flip `active` or close/open encounters mid-gesture.
        visualIndexRef.current = nextIndex
        setVisualIndex(nextIndex)
      }
      if (scrollIdleTimerRef.current != null) {
        window.clearTimeout(scrollIdleTimerRef.current)
      }
      // Fallback when `scrollend` is unavailable (older WebViews).
      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollIdleTimerRef.current = null
        flushScrollSettled()
      }, 120)
    },
    [cards.length, flushScrollSettled, roundComplete, scrollChannel],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // The quiz dialog is a React child of this feed (portaled in the DOM), so its
      // ArrowUp/ArrowDown retarget here. A focused control inside the scroller can
      // also snap the card underneath via the browser's default arrow scroll.
      const direction = getFreestyleFeedPageDirection(event.key)
      if (event.defaultPrevented || isFreestyleShortcutBlocked(event.target)) {
        if (direction && shouldSwallowFreestyleFeedPageKey(event.target, event.currentTarget)) {
          event.preventDefault()
        }
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
      ) {
        return
      }
      if (!direction) return
      event.preventDefault()
      if (direction === 'previous') navigatePrevious()
      else navigateNext()
    },
    [navigateNext, navigatePrevious],
  )

  const viewingCardId = viewingCompleteSlot ? null : (cards[visualIndex]?.id ?? null)
  const earliestUnhandledIndex = useMemo(
    () => findEarliestCompleteSeekIndex(
      cards,
      queueState.unitEncountersByCardId,
      queueState.completedIds,
      roundPlan,
    ),
    [cards, queueState.completedIds, queueState.unitEncountersByCardId, roundPlan],
  )
  const completeSeekIndex = useMemo(
    () => resolveFreestyleCompleteSeek({
      roundComplete,
      cardCount: cards.length,
      earliestUnhandledIndex,
      visualIndex,
    }),
    [cards.length, earliestUnhandledIndex, roundComplete, visualIndex],
  )
  const canCompleteRound = completeSeekIndex != null
  const completeTitle = roundComplete
    ? '进入本轮结算'
    : '定位到最早还没评分的单元'
  const handleCompleteRound = useCallback(() => {
    if (completeSeekIndex == null) return
    navigateToIndex(completeSeekIndex, { skipHistory: true })
  }, [completeSeekIndex, navigateToIndex])

  return {
    scrollRef,
    visualIndex,
    mounted,
    viewingCompleteSlot,
    viewingCardId,
    canGoPrevious,
    readOnlyHistoryCardId,
    navigateToIndex,
    navigatePrevious,
    navigateNext,
    handleScroll,
    handleKeyDown,
    canCompleteRound,
    completeTitle,
    handleCompleteRound,
    scrollChannel,
    edgeHint,
  }
}
