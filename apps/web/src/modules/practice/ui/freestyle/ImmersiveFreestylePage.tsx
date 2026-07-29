import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from 'react'
import {
  ChevronDown,
  ChevronUp,
  History,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  Star,
  Waypoints,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { FreestyleFeedSettingsDialog } from '@/modules/practice/ui/freestyle/components/FreestyleFeedSettingsDialog'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleMindMapBranchCardView } from '@/modules/practice/ui/freestyle/components/FreestyleMindMapBranchCardView'
import { FreestyleUnitReviewCardView } from '@/modules/practice/ui/freestyle/components/FreestyleUnitReviewCardView'
import { FreestyleQuizCardView } from '@/modules/practice/ui/freestyle/components/FreestyleQuizCardView'
import {
  FreestyleEmptyState,
  FreestyleFeedErrorState,
  FreestyleLoadingState,
} from '@/modules/practice/ui/freestyle/components/FreestyleFeedStates'
import { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import { useFreestyleQuizFlow } from '@/modules/practice/ui/freestyle/hooks/useFreestyleQuizFlow'
import {
  formatTimer,
  isMindMapBranchCard,
  isQuizCard,
} from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import {
  canPopViewHistory,
  popViewHistory,
  pushViewHistory,
  visibleMountIndices,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { toast } from '@/shared/feedback/toast'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { cn } from '@/shared/lib/utils'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

const FREESTYLE_SECTION_LINKS = [
  { to: '/palaces', label: '知识' },
  { to: '/english', label: '英语' },
  { to: '/palaces/new', label: '创建' },
  { to: '/dashboard', label: '洞察' },
  { to: '/today', label: '今日工作台' },
] as const

function StaleUnitReviewCard({
  cardId,
  onStaleDrop,
}: {
  cardId: string
  onStaleDrop: (cardId: string) => void
}) {
  useEffect(() => {
    onStaleDrop(cardId)
  }, [cardId, onStaleDrop])
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
      <RefreshCw className="mr-2 size-4 animate-spin" />
      正在重建复习队列...
    </div>
  )
}

export default function ImmersiveFreestylePage() {
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  const reducedMotion = usePrefersReducedMotion()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const queueRef = useRef<FreestyleCard[]>([])
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
  const acknowledgedCardIdsRef = useRef<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [ratingMode, setRatingMode] = useState(true)
  const [saveError, setSaveError] = useState('')
  const [readOnlyHistoryCardId, setReadOnlyHistoryCardId] = useState<string | null>(null)
  const { promptForAiOptions } = useAiRunConfigDialog()

  const {
    config,
    setConfigAndPersist,
    queueState,
    cards,
    currentIndex,
    goToIndex,
    flushDeferredRestudy,
    loading,
    error,
    refreshQueue,
    reshuffleQueue,
    completeCard,
    acknowledgeCard,
    ensureUnitEncounter,
    updateUnitEncounter,
    dropStaleCard,
    skipToNextPalace,
    buildQueue,
  } = useImmersiveQueue()

  queueRef.current = cards
  const currentCard = cards[currentIndex] ?? null

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
    refreshCanGoPrevious()
  }, [refreshCanGoPrevious, cards, currentIndex])

  const timer = useTimedSession({
    kind: 'quiz',
    title: '随心模式',
    palaceId: null,
    automationScene: 'freestyle',
    sourceKind: null,
    persistKey: 'freestyle-immersive',
  })

  useGlobalTimerRegistration({
    scene: 'freestyle',
    title: '随心模式',
    timer,
    isRouteActive: isActive,
    becameActiveAt,
    routePath: fullPath,
  })

  const {
    progress,
    updateQuestionState,
    handleChoiceResolve,
    handleShortAnswerSubmit,
    handleShortAnswerFeedback,
    answeredQuestionIds,
  } = useFreestyleQuizFlow({
    mode: 'free',
    queueRef,
    timer,
    reducedMotion,
    promptForAiOptions,
    // Avoid restoring prior choice states that disable options on reappearance.
    freshAttemptStates: true,
    updateFeedQuestion: () => {
      // Question payload updates are optional for immersive queue cards.
    },
  })

  useEffect(() => {
    timer.setSceneActive(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  useEffect(() => {
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig())) return
    timer.start({ source: 'page_enter' })
  }, [isActive, timer])

  // New round / reshuffle clears completed bookkeeping; reset local ack set too.
  // Intentionally omit completedIds: mid-round membership must not rebuild the ack set
  // (settlement may still be in flight after a local ack).
  useEffect(() => {
    acknowledgedCardIdsRef.current = new Set(queueState.completedIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on new round
  }, [queueState.roundId])

  const scrollToIndex = useCallback(
    (index: number, behavior?: ScrollBehavior) => {
      const node = scrollRef.current
      if (!node || !node.clientHeight) return
      programmaticScrollRef.current = true
      node.scrollTo({
        top: index * node.clientHeight,
        // Prefer instant snap for feed paging; smooth fights CSS scroll-snap and feels laggy.
        behavior: behavior ?? 'auto',
      })
      window.setTimeout(() => {
        programmaticScrollRef.current = false
      }, behavior === 'smooth' ? 420 : 50)
    },
    [],
  )

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
        /** Historical navigation shows a closed encounter without creating a new one. */
        historical?: boolean
      },
    ) => {
      const max = Math.max(0, cards.length - 1)
      const next = Math.max(0, Math.min(index, max))
      const targetCardId = cards[next]?.id ?? null
      setReadOnlyHistoryCardId(
        options?.historical || next < currentIndex ? targetCardId : null,
      )
      const fromScroll = options?.scroll === false
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
        refreshCanGoPrevious(next)
        return
      }
      // Same index: React may bail out of setState; still align the viewport.
      if (next === currentIndex) {
        scrollToIndex(next)
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
    [cards, currentIndex, goToIndex, refreshCanGoPrevious, scrollToIndex],
  )

  /**
   * 「上一张」: prefer view history so restudy/skip reorders still return to the
   * unit just left (even when that unit is no longer at index-1, or when the next
   * unit slid into index 0 and index-based back would stay disabled).
   */
  const navigatePrevious = useCallback(() => {
    const list = cards
    const currentId = list[currentIndex]?.id ?? null
    const popped = popViewHistory(viewHistoryRef.current, list, currentId)
    if (popped) {
      viewHistoryRef.current = popped.history
      const targetIndex = list.findIndex((card) => card.id === popped.targetId)
      if (targetIndex >= 0) {
        navigateToIndex(targetIndex, { skipHistory: true, historical: true })
        return
      }
    }
    if (currentIndex > 0) {
      navigateToIndex(currentIndex - 1, { skipHistory: true, historical: true })
    }
  }, [cards, currentIndex, navigateToIndex])

  useEffect(() => {
    if (requestedScrollIndexRef.current !== currentIndex) return
    requestedScrollIndexRef.current = null
    scrollToIndex(currentIndex)
  }, [currentIndex, scrollToIndex])

  /**
   * After finger/wheel inertia ends: apply deferred restudy placement, then pin
   * the card still under the viewport by id. Never advances past that card.
   */
  const flushScrollSettled = useCallback(() => {
    userScrollingRef.current = false
    if (programmaticScrollRef.current) return
    const pinned = flushDeferredRestudy()
    const node = scrollRef.current
    if (!node?.clientHeight) return
    const expectedTop = pinned * node.clientHeight
    if (Math.abs(node.scrollTop - expectedTop) > 2) {
      scrollToIndex(pinned, 'auto')
    }
  }, [flushDeferredRestudy, scrollToIndex])

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
   * Route residency hides inactive pages with `display: none`, which often resets
   * scrollTop to 0. Remounts also start the scroller at the top even when
   * `currentIndex` was restored from queue state. Re-align only for route /
   * load / index identity — never on silent rebuild card-id churn, and never
   * while the user is scrolling (that used to fight snap and look like
   * auto page-turn after settle rebuilds).
   */
  useLayoutEffect(() => {
    if (!isActive || loading || cards.length === 0) return
    if (userScrollingRef.current || programmaticScrollRef.current) return
    if (indexChangeFromScrollRef.current) {
      indexChangeFromScrollRef.current = false
      return
    }
    const node = scrollRef.current
    if (!node?.clientHeight) return
    const expectedTop = currentIndex * node.clientHeight
    if (Math.abs(node.scrollTop - expectedTop) < 2) return
    scrollToIndex(currentIndex, 'auto')
  }, [
    isActive,
    becameActiveAt,
    loading,
    currentIndex,
    scrollToIndex,
    // cards.length only gates the early return; silent rebuilds must not re-scroll.
    cards.length,
  ])

  const acknowledgeQuizCard = useCallback(
    (card: FreestyleQuizCard) => {
      if (acknowledgedCardIdsRef.current.has(card.id)) return
      acknowledgedCardIdsRef.current.add(card.id)
      // Keep the card in the feed so analysis stays visible and swipe-back works.
      // User advances manually (swipe / 下一题) — never auto-jump after answer.
      acknowledgeCard(card.id)
    },
    [acknowledgeCard],
  )

  const handleBranchComplete = useCallback(
    (cardId: string, options?: { restudy?: boolean; cleared?: boolean }) => {
      if (saveError) return
      // Mind-map settles often stopPropagation; register here so idle timers start.
      timer.registerActivity('practice_interaction', { source: 'freestyle_branch_complete' })
      // A passed unit marks completedIds and rebuilds silently; stay on card.
      // Weak ratings (restudy) skip completedIds; never auto-flip to the next unit.
      completeCard(cardId, options)
    },
    [completeCard, saveError, timer],
  )

  const handleStaleDrop = useCallback(
    (cardId: string) => {
      // Do not mark completed — still-due units must stay eligible (vs Insights queue).
      dropStaleCard(cardId)
    },
    [dropStaleCard],
  )

  const onChoiceResolve = useCallback(
    (card: FreestyleQuizCard, optionId: string, isCorrect: boolean) => {
      handleChoiceResolve(card, optionId, isCorrect)
      acknowledgeQuizCard(card)
    },
    [acknowledgeQuizCard, handleChoiceResolve],
  )

  const onShortAnswerSubmit = useCallback(
    (card: FreestyleQuizCard) => {
      handleShortAnswerSubmit(card)
      acknowledgeQuizCard(card)
    },
    [acknowledgeQuizCard, handleShortAnswerSubmit],
  )

  // Non-choice types (true/false, fill, match, …) resolve only via onStateChange.
  useEffect(() => {
    const card = cards[currentIndex]
    if (!card || !isQuizCard(card)) return
    if (acknowledgedCardIdsRef.current.has(card.id)) return
    const state = progress.questionStates[card.question.id]
    if (!state?.resolved) return
    // Multiple-choice / short-answer already handled in their explicit handlers.
    if (
      card.question.question_type === 'multiple_choice' ||
      card.question.question_type === 'short_answer'
    ) {
      return
    }
    acknowledgeQuizCard(card)
  }, [acknowledgeQuizCard, cards, currentIndex, progress.questionStates])

  const mounted = useMemo(
    () => visibleMountIndices(currentIndex, cards.length),
    [cards.length, currentIndex],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (programmaticScrollRef.current) return
      const element = event.currentTarget
      if (!element.clientHeight || cards.length === 0) return
      userScrollingRef.current = true
      const nextIndex = Math.max(
        0,
        Math.min(cards.length - 1, Math.round(element.scrollTop / element.clientHeight)),
      )
      timer.registerActivity('practice_interaction', { source: 'freestyle_scroll' })
      if (nextIndex !== currentIndex) {
        // Index only — do not call scrollTo; CSS snap + the user's gesture own the viewport.
        // Defer restudy reordering until the gesture settles (see flushScrollSettled).
        navigateToIndex(nextIndex, { scroll: false, reorderRestudy: false })
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
    [cards.length, currentIndex, flushScrollSettled, navigateToIndex, timer],
  )

  /**
   * 「下个宫殿」reorders the feed under the current slot (nextIndex often equals
   * currentIndex). Force an auto scroll after paint so snap / scroll-anchoring
   * cannot keep the previous card in view — that looked like「下一题」.
   */
  const handleSkipToNextPalace = useCallback(() => {
    setReadOnlyHistoryCardId(null)
    const leavingId = cards[currentIndex]?.id
    if (leavingId) {
      viewHistoryRef.current = pushViewHistory(viewHistoryRef.current, leavingId)
    }
    const nextIndex = skipToNextPalace()
    requestedScrollIndexRef.current = nextIndex
    refreshCanGoPrevious(nextIndex)
    // Double-rAF: wait until React commits the reordered children, then snap.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToIndex(nextIndex, 'auto')
        requestedScrollIndexRef.current = null
      })
    })
  }, [cards, currentIndex, refreshCanGoPrevious, scrollToIndex, skipToNextPalace])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
      ) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        navigateToIndex(currentIndex + 1)
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        navigatePrevious()
      }
    },
    [currentIndex, navigatePrevious, navigateToIndex],
  )

  const mindmapCount = cards.filter(isMindMapBranchCard).length
  const quizCount = cards.filter(isQuizCard).length
  const unitReviewActive = Boolean(
    currentCard
    && currentCard.type === 'mindmap_branch'
    && currentCard.unit_id
    && currentCard.unit_revision != null,
  )
  const resolvedQuiz = cards.filter(
    (card) => isQuizCard(card) && answeredQuestionIds.has(card.question.id),
  ).length

  const hudActionClass =
    'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-200 transition-colors hover:bg-white/10 active:bg-white/15 sm:size-9'

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative max-w-full overflow-hidden text-zinc-50',
          // Soft stage: one continuous dark field so card chrome does not float on flat black.
          'bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(52,211,153,0.08),transparent_45%),linear-gradient(180deg,#0c0d10_0%,#09090b_100%)]',
          // Immersive freestyle hides mobile bottom nav; use almost full viewport height on phone.
          'h-[calc(100dvh-env(safe-area-inset-bottom,0px))] min-h-0 rounded-xl border border-white/5 shadow-2xl max-lg:rounded-none max-lg:border-0 lg:h-[calc(100vh-88px)]',
        )}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <FreestyleFeedSettingsDialog
          open={settingsOpen}
          config={config}
          onOpenChange={setSettingsOpen}
          onSave={setConfigAndPersist}
        />
        <FreestyleHistoryDialog
          open={historyOpen}
          currentCard={currentCard}
          currentPalaceId={
            currentCard?.type === 'mindmap_branch'
              ? currentCard.palace_id
              : currentCard?.type === 'quiz_question'
                ? currentCard.palace_context?.id ?? null
                : currentCard?.palace_context?.id ?? null
          }
          mode="free"
          onOpenChange={setHistoryOpen}
        />

        {/* Compact top HUD — progress + timer + rating toggle + overflow menu */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2 pt-[max(0.35rem,env(safe-area-inset-top,0px))] sm:px-3 sm:pt-2.5">
          <div className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-2xl border border-white/10 bg-zinc-950/88 px-1 py-0.5 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-md sm:gap-1.5 sm:rounded-full sm:px-2 sm:py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 sm:gap-2 sm:px-2">
              <span className="shrink-0 tabular-nums text-sm font-medium text-zinc-100">
                {cards.length === 0 ? '0/0' : `${currentIndex + 1}/${cards.length}`}
              </span>
              <span className="hidden min-w-0 truncate text-xs text-zinc-500 md:inline">
                导图 {mindmapCount} · 题 {quizCount}
                {resolvedQuiz > 0 ? ` · 已答 ${resolvedQuiz}` : ''}
              </span>
              <button
                type="button"
                className={cn(
                  'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 tabular-nums text-xs sm:text-sm',
                  timer.status === 'running'
                    ? 'text-emerald-300'
                    : timer.status === 'paused'
                      ? 'text-amber-200'
                      : 'text-zinc-400',
                  'hover:bg-white/10 active:bg-white/15',
                )}
                title={
                  timer.status === 'running'
                    ? '暂停计时'
                    : timer.status === 'paused'
                      ? '继续计时'
                      : '开始计时'
                }
                aria-label={
                  timer.status === 'running'
                    ? '暂停计时'
                    : timer.status === 'paused'
                      ? '继续计时'
                      : '开始计时'
                }
                onClick={() => {
                  if (timer.status === 'running') {
                    timer.pause({ source: 'freestyle_hud' })
                    return
                  }
                  if (timer.status === 'paused') {
                    timer.resume({ source: 'freestyle_hud' })
                    return
                  }
                  timer.start({ source: 'freestyle_hud' })
                }}
              >
                {timer.status === 'running'
                  ? formatTimer(timer.effectiveSeconds)
                  : timer.status === 'paused'
                    ? `暂停 ${formatTimer(timer.effectiveSeconds)}`
                    : '计时'}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-1 sm:gap-1 sm:pl-1.5">
              <button
                type="button"
                className={cn(
                  hudActionClass,
                  ratingMode
                    ? 'bg-amber-300/20 text-amber-50'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
                title={ratingMode ? '评分开：点击关闭' : '评分关：点击开启'}
                aria-label={ratingMode ? '评分开' : '评分关'}
                aria-pressed={ratingMode}
                onClick={() => setRatingMode((value) => !value)}
              >
                <Star className={cn('size-4', ratingMode && 'fill-current')} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={hudActionClass}
                    title="更多"
                    aria-label="更多"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onSelect={() => refreshQueue()}>
                    <RefreshCw className="mr-2 size-4" />
                    刷新队列
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                    <History className="mr-2 size-4" />
                    历史
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                    <Settings2 className="mr-2 size-4" />
                    设置
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    切换模块
                  </DropdownMenuLabel>
                  {FREESTYLE_SECTION_LINKS.map((item) => (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link to={item.to}>{item.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {saveError ? (
          <div className="absolute left-1/2 top-[4.25rem] z-30 max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-rose-400/30 bg-rose-950/95 px-4 py-2.5 text-sm text-rose-100 shadow-lg">
            {saveError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setSaveError('')}
            >
              关闭
            </button>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          data-page-history-scroll-key="freestyle-immersive"
          // overflow-anchor-none: reordering cards for「下个宫殿」must not let the
          // browser keep the old card glued to the viewport (looks like no jump).
          className="h-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-contain [overflow-anchor:none] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden touch-pan-y"
          onScroll={handleScroll}
        >
          {loading ? (
            <FreestyleLoadingState />
          ) : error ? (
            <FreestyleFeedErrorState
              feedError={error}
              mode="free"
              config={{
                range: 'all',
                contentTypes: {
                  quiz_question: true,
                  review: false,
                  english: false,
                  english_reading: false,
                },
                specificPalaceIds: config.specific_palace_ids,
                orderMode: 'sequential',
                questionType: config.question_type,
                actionFrequency: 'none',
                seed: config.seed,
              }}
              todayConfig={{
                roundSize: 12,
                includeEnglish: false,
                includeEnglishReading: false,
                seed: config.seed,
              }}
              onLoadFeed={async () => {
                refreshQueue()
              }}
              onLoadTodayFeed={async () => {
                refreshQueue()
              }}
              onCopyDiagnostics={async () => {
                await navigator.clipboard.writeText(error)
                toast.success('已复制诊断信息')
              }}
            />
          ) : cards.length === 0 ? (
            <FreestyleEmptyState
              mode="free"
              onSwitchMode={() => undefined}
              onReshuffle={reshuffleQueue}
              onOpenSettings={() => setSettingsOpen(true)}
              completedCount={queueState.completedIds.length}
              mutedCount={queueState.mutedPalaceIds.length}
              hiddenCount={queueState.hiddenIds.length}
            />
          ) : (
            cards.map((card, index) => {
              if (!mounted.has(index)) {
                return (
                  <div
                    key={card.id}
                    className="h-full min-h-full snap-start snap-always"
                    aria-hidden
                  />
                )
              }
              return (
                <div
                  key={card.id}
                  className={cn(
                    'box-border flex h-full min-h-full flex-col snap-start snap-always',
                    // HUD top inset only; rating overlay floats over map bottom on mobile.
                    'px-2 pb-2 pt-[calc(3rem+env(safe-area-inset-top,0px))] sm:px-3 sm:pb-3 sm:pt-14',
                  )}
                >
                  {isMindMapBranchCard(card) ? (
                    card.type === 'mindmap_branch' ? (
                      card.unit_id && card.unit_revision != null ? (
                        <FreestyleUnitReviewCardView
                          card={card}
                          active={isActive && index === currentIndex}
                          readOnly={readOnlyHistoryCardId === card.id}
                          roundId={queueState.roundId}
                          encounter={queueState.unitEncountersByCardId[card.id]}
                          retryAfterCards={Math.min(3, Math.max(0, cards.length - index - 1))}
                          ratingVisible={ratingMode}
                          onEnsureEncounter={ensureUnitEncounter}
                          onEncounterChange={updateUnitEncounter}
                          onBranchComplete={handleBranchComplete}
                          onStaleDrop={handleStaleDrop}
                          onSaveFailed={(message) => {
                            setSaveError(message)
                            toast.error(message)
                          }}
                          onUnitsReconciled={() => {
                            void buildQueue(config, {
                              preserveCompleted: true,
                              silent: true,
                              preferCardId: card.id,
                            })
                          }}
                        />
                      ) : (
                        <StaleUnitReviewCard
                          cardId={card.id}
                          onStaleDrop={handleStaleDrop}
                        />
                      )
                    ) : (
                      <FreestyleMindMapBranchCardView
                        card={card}
                        active={isActive && index === currentIndex}
                        onBranchComplete={handleBranchComplete}
                        reducedMotion={reducedMotion}
                      />
                    )
                  ) : isQuizCard(card) ? (
                    <FreestyleQuizCardView
                      card={card}
                      state={progress.questionStates[card.question.id]}
                      answeredBefore={answeredQuestionIds.has(card.question.id)}
                      onStateChange={(updater) => updateQuestionState(card.question.id, updater)}
                      onChoiceResolve={(optionId, isCorrect) =>
                        onChoiceResolve(card, optionId, isCorrect)
                      }
                      onShortAnswerSubmit={() => {
                        onShortAnswerSubmit(card)
                      }}
                      onRequestShortAnswerFeedback={() => {
                        void handleShortAnswerFeedback(card)
                      }}
                      onRequestNext={() => {
                        navigateToIndex(index + 1)
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                      暂不支持的卡片类型
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Nav dock: desktop mid-right; phone lower-right above rating overlay */}
        <div
          className={cn(
            'pointer-events-none absolute z-20',
            'right-3 top-1/2 -translate-y-1/2',
            unitReviewActive && ratingMode
              ? 'max-lg:bottom-[calc(6.75rem+env(safe-area-inset-bottom,0px))] max-lg:right-2 max-lg:top-auto max-lg:translate-y-0'
              : 'max-lg:bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] max-lg:right-2 max-lg:top-auto max-lg:translate-y-0',
          )}
        >
          <div
            className={cn(
              'pointer-events-auto flex flex-col gap-1 rounded-2xl border border-white/12 bg-zinc-950/90 p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)] backdrop-blur-md',
              'max-lg:flex-row max-lg:items-center',
            )}
          >
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-xl text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-35 sm:size-10"
              title="上一张：返回上一个单元"
              aria-label="上一张"
              disabled={!canGoPrevious || cards.length === 0}
              onClick={navigatePrevious}
            >
              <ChevronUp className="size-5 sm:size-4" />
            </button>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-xl text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-35 sm:size-10"
              title="下一张"
              aria-label="下一张"
              disabled={cards.length === 0 || currentIndex >= cards.length - 1}
              onClick={() => navigateToIndex(currentIndex + 1)}
            >
              <ChevronDown className="size-5 sm:size-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 sm:h-10 sm:flex-col sm:gap-0.5 sm:px-2 sm:py-1"
              title="下个宫殿：本宫殿剩余内容移到队尾"
              aria-label="下个宫殿"
              onClick={handleSkipToNextPalace}
            >
              <Waypoints className="size-4 shrink-0" />
              <span className="leading-none">下个</span>
            </button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
