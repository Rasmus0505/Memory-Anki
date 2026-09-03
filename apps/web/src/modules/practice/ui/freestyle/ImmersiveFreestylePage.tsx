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
  History,
  ListChecks,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react'
import { FreestyleProgressRail } from '@/modules/practice/ui/freestyle/components/FreestyleProgressRail'
import { FreestyleRoundCompleteCard } from '@/modules/practice/ui/freestyle/components/FreestyleRoundCompleteCard'
import { buildFreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import {
  buildFreestyleRoundCompletion,
  isFreestyleRoundComplete,
} from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleRoundConfigDialog } from '@/modules/practice/ui/freestyle/components/FreestyleRoundConfigDialog'
import { FreestyleRoundSheet } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSheet'
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
import { useFreestyleLiveMirror } from '@/modules/practice/ui/freestyle/hooks/useFreestyleLiveMirror'
import type { FreestyleAnkiFlipLiveState } from '@/modules/practice/ui/freestyle/model/freestyleLiveView'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { parseFreestyleEntryPalaceId } from '@/modules/practice/ui/freestyle/model/freestyle-entry-scope'
import {
  isMindMapBranchCard,
  isQuizCard,
} from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  getFreestyleQuestionDirection,
  isFreestyleOverlayOpen,
  isFreestyleShortcutBlocked,
} from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import { FreestyleChannelHint } from '@/modules/practice/ui/freestyle/components/FreestyleChannelHint'
import { FreestyleFeedPager } from '@/modules/practice/ui/freestyle/components/FreestyleFeedPager'
import { FreestylePalaceClearedBanner } from '@/modules/practice/ui/freestyle/components/FreestylePalaceClearedBanner'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import {
  buildPalaceClearance,
  isPalaceRoundCleared,
  leftoverDueForPalace,
  type PalaceClearance,
} from '@/modules/practice/ui/freestyle/model/freestylePalaceClearance'
import { buildPalaceRatingTarget } from '@/modules/practice/ui/freestyle/model/freestylePalaceRating'
import { useFreestyleChromeTheme } from '@/modules/practice/ui/freestyle/hooks/useFreestyleChromeTheme'
import { useFreestyleWakeLock } from '@/modules/practice/ui/freestyle/hooks/useFreestyleWakeLock'
import {
  CHANNEL_HINT_COOLDOWN_MS,
  EMPTY_CHANNEL_LOG,
  channelAdjustment,
  channelLogSamples,
  readChallengeChannel,
  recordChannelRating,
  shouldSurfaceChannelHint,
  type ChannelLog,
} from '@/modules/practice/ui/freestyle/model/freestyleChallengeChannel'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import {
  canPopViewHistory,
  cardPalaceId,
  findNextPalaceIndex,
  findPreviousPalaceIndex,
  getFreestylePassedCardIds,
  getFreestyleRatedCardIds,
  isSequentialPalaceBlocked,
  popViewHistory,
  pushViewHistory,
  visibleMountIndices,
  FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  isQueueStateFromPreviousDay,
  type FreestyleFlipMode,
  type FreestyleRatingScope,
  type UnitRating,
  readFreestyleDisplaySettings,
  sanitizeFreestyleDisplaySettings,
  saveFreestyleDisplaySettings,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig, FreestyleMindMapBranchCard, FreestyleQuizCard } from '@/shared/api/contracts'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { getDesktopTimerBridge } from '@/shared/components/session/desktopTimerBridge'
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
import { onAppEvent } from '@/shared/events/appEvents'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { cn } from '@/shared/lib/utils'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

/** Long enough for the undo chip to register before the page turns. */
const AUTO_ADVANCE_DELAY_MS = 700

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

function incompleteUnitLabel(card: FreestyleMindMapBranchCard): string {
  const path = Array.isArray(card.context_path)
    ? card.context_path.map((item) => String(item?.text || '').trim()).filter(Boolean)
    : []
  return path.at(-1) || card.palace_title || (card.unit_id ? `单元 ${card.unit_id}` : `卡片 ${card.id}`)
}

function FreestyleRetryCornerBadge({
  card,
  retryAfterCards,
}: {
  card: FreestyleCard
  retryAfterCards?: number
}) {
  const isRetry = card.occurrence_kind === 'retry'
  const isSourceRetry = !isRetry && retryAfterCards != null
  if (!isRetry && !isSourceRetry) return null
  const label = isRetry
    ? `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次`
    : `${Math.max(0, retryAfterCards ?? 3)} 张后重练`
  return (
    <div
      data-testid="freestyle-retry-corner-badge"
      role="status"
      // Left, under the title chip: the mobile nav dock this used to dodge is gone,
      // the bottom edge belongs to the rating bar, and the top-right holds the
      // timer dot + overflow.
      className="pointer-events-none absolute left-4 top-[calc(3.25rem+env(safe-area-inset-top,0px))] z-30 inline-flex items-center gap-1 rounded-full border border-zinc-300/80 bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-lg backdrop-blur-sm sm:top-14 dark:border-white/20 dark:bg-zinc-900/92 dark:text-zinc-100"
    >
      <span aria-hidden>{isRetry ? '↻' : '·'}</span>
      {label}
    </div>
  )
}

export default function ImmersiveFreestylePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const entryPalaceId = parseFreestyleEntryPalaceId(searchParams.toString())
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  useFreestyleWakeLock(isActive)
  useFreestyleChromeTheme(isActive)
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
  const pageHeightRef = useRef(0)
  const [visualIndex, setVisualIndex] = useState(0)
  const visualIndexRef = useRef(0)
  const [palaceClearance, setPalaceClearance] = useState<PalaceClearance | null>(null)
  const announcedPalaceClearanceRef = useRef<string | null>(null)
  const acknowledgedCardIdsRef = useRef<Set<string>>(new Set())
  const autoAdvanceTimerRef = useRef<number | null>(null)
  /** Read at auto-advance fire time so a settle-time reorder cannot turn the wrong page. */
  const currentIndexRef = useRef(0)
  const [planOpen, setPlanOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [flipMode, setFlipMode] = useState<FreestyleFlipMode>(
    () => readFreestyleDisplaySettings().flip_mode,
  )
  const [liveAnkiFlip, setLiveAnkiFlip] = useState<FreestyleAnkiFlipLiveState | null>(null)
  const [liveRevealMap, setLiveRevealMap] = useState<Record<string, string> | null>(null)
  const [autoAdvance, setAutoAdvance] = useState(
    () => readFreestyleDisplaySettings().auto_advance,
  )
  const [ratingScope, setRatingScope] = useState<FreestyleRatingScope>(
    () => readFreestyleDisplaySettings().rating_scope,
  )
  const [mindmapZoom, setMindmapZoom] = useState(
    () => readFreestyleDisplaySettings().mindmap_zoom,
  )
  const [freestyleFullscreen, setFreestyleFullscreen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [readOnlyHistoryCardId, setReadOnlyHistoryCardId] = useState<string | null>(null)
  const { promptForAiOptions } = useAiRunConfigDialog()
  /** Challenge–skill channel rating log for this session. See ChannelLog for the keying. */
  const [channelLog, setChannelLog] = useState<ChannelLog>(EMPTY_CHANNEL_LOG)
  /**
   * Suppression is a timer-cleared flag rather than a stored timestamp compared during
   * render: a render-time `Date.now()` never re-evaluates on its own, so the hint would
   * stay hidden past its cooldown until some unrelated re-render happened to occur.
   */
  const [channelHintSuppressed, setChannelHintSuppressed] = useState(false)
  const channelHintCooldownRef = useRef<number | null>(null)
  const [channelAdjusting, setChannelAdjusting] = useState(false)
  const [channelAppliedHint, setChannelAppliedHint] = useState('')
  const [yesterdayHintDismissed, setYesterdayHintDismissed] = useState(false)

  const {
    config,
    setConfigAndPersist,
    queueState,
    roundMeta,
    roundPlan,
    cards,
    currentIndex,
    goToIndex,
    flushDeferredRestudy,
    loading,
    error,
    refreshQueue,
    reshuffleQueue,
    completeCard,
    completeCardBatch,
    acknowledgeCard,
    ensureUnitEncounter,
    updateUnitEncounter,
    dropStaleCard,
    reorderPlan,
    excludePlanCards,
    restorePlanCards,
    skipToNextPalace,
    buildQueue,
    pendingRestudyCardIds,
  } = useImmersiveQueue(entryPalaceId)
  const queueStateRef = useRef(queueState)
  const { signalPalaceCleared } = useFreestyleFlowFeedback()

  useEffect(() => {
    return onAppEvent(FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT, (detail) => {
      const settings = sanitizeFreestyleDisplaySettings(detail)
      setFlipMode(settings.flip_mode)
      setAutoAdvance(settings.auto_advance)
      setRatingScope(settings.rating_scope)
      setMindmapZoom(settings.mindmap_zoom)
    })
  }, [])

  useEffect(() => {
    if (!freestyleFullscreen) return
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFreestyleFullscreen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [freestyleFullscreen])

  useEffect(() => {
    const bridge = getDesktopTimerBridge()
    const unsubscribe = bridge?.onMainWindowFullscreenChange?.((active) => {
      setFreestyleFullscreen(active)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (bridge?.setMainWindowFullscreen) {
      bridge.setMainWindowFullscreen(freestyleFullscreen)
      return
    }

    // Installed PWA/browser fallback. The desktop shell uses native window
    // fullscreen so the Electron title bar and Windows taskbar disappear too.
    if (freestyleFullscreen) {
      if (document.fullscreenElement) return
      if (typeof document.documentElement.requestFullscreen === 'function') {
        void document.documentElement.requestFullscreen().catch(() => undefined)
      }
      return
    }
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      void document.exitFullscreen().catch(() => undefined)
    }
  }, [freestyleFullscreen])

  useEffect(() => {
    const bridge = getDesktopTimerBridge()
    if (bridge?.onMainWindowFullscreenChange) return
    const handleDocumentFullscreenChange = () => {
      setFreestyleFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleDocumentFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleDocumentFullscreenChange)
  }, [])

  useEffect(() => {
    return () => {
      getDesktopTimerBridge()?.setMainWindowFullscreen?.(false)
    }
  }, [])

  const updateFlipMode = useCallback((next: FreestyleFlipMode) => {
    setFlipMode(next)
    saveFreestyleDisplaySettings({ flip_mode: next })
  }, [])

  const updateRatingScope = useCallback((next: FreestyleRatingScope) => {
    setRatingScope(next)
    saveFreestyleDisplaySettings({ rating_scope: next })
  }, [])

  const updateAutoAdvance = useCallback((next: boolean) => {
    setAutoAdvance(next)
    saveFreestyleDisplaySettings({ auto_advance: next })
  }, [])

  const updateMindmapZoom = useCallback((next: number) => {
    const saved = saveFreestyleDisplaySettings({ mindmap_zoom: next })
    setMindmapZoom(saved.mindmap_zoom)
  }, [])

  const saveFreestyleConfig = useCallback((nextConfig: FreestyleFeedConfig) => {
    setConfigAndPersist(nextConfig)
    // A shelf link is a launch hint. Remove it after saving so refresh cannot
    // reapply the old single-palace scope over the saved selection.
    if (entryPalaceId != null) navigate('/freestyle', { replace: true })
  }, [entryPalaceId, navigate, setConfigAndPersist])

  queueRef.current = cards
  currentIndexRef.current = currentIndex
  queueStateRef.current = queueState
  visualIndexRef.current = visualIndex
  const currentCard = cards[currentIndex] ?? null
  const palaceRatingTarget = useMemo(() => {
    if (!currentCard || currentCard.type !== 'mindmap_branch' || !currentCard.unit_id) return null
    return buildPalaceRatingTarget({
      current: currentCard,
      cards,
      leftoverDue: leftoverDueForPalace(roundMeta.palace_leftover_due, currentCard.palace_id),
      completedIds: queueState.completedIds,
      encountersByCardId: queueState.unitEncountersByCardId,
    })
  }, [cards, currentCard, queueState.completedIds, queueState.unitEncountersByCardId, roundMeta.palace_leftover_due])
  const passedCardIds = useMemo(
    () => getFreestylePassedCardIds(cards, queueState.completedIds, queueState.unitEncountersByCardId),
    [cards, queueState.completedIds, queueState.unitEncountersByCardId],
  )

  const getIncompleteUnitSummary = useCallback(
    (palaceId: number | null) => {
      const seen = new Set<string>()
      const rated = new Set(passedCardIds)
      return cards
        .filter((card): card is FreestyleMindMapBranchCard => cardPalaceId(card) === palaceId && card.type === 'mindmap_branch' && Boolean(card.unit_id))
        .filter((card) => {
          const sourceId = String(card.source_card_id || card.id)
          if (rated.has(card.id) || rated.has(sourceId) || seen.has(sourceId)) return false
          seen.add(sourceId)
          return true
        })
        .map(incompleteUnitLabel)
    },
    [cards, passedCardIds],
  )

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

  useEffect(() => {
    if (userScrollingRef.current) return
    setVisualIndex(currentIndex)
    visualIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    announcedPalaceClearanceRef.current = null
    setPalaceClearance(null)
  }, [queueState.roundId])

  const timer = useTimedSession({
    sessionKey: 'freestyle',
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
      if (
        isSequentialPalaceBlocked(
          cards,
          currentIndex,
          next,
          passedCardIds,
          config.palace_order,
        )
      ) {
        // The reason lives on the card (see sequentialBlockedHint) — a toast fired
        // exactly when the learner tried to move on, and listed unit names.
        if (options?.scroll === false) {
          window.requestAnimationFrame(() => scrollToIndex(currentIndex, 'auto'))
        }
        return
      }
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
    // getIncompleteUnitSummary is intentionally absent: the hint moved onto the card
    // (see sequentialBlockedHint), so this callback no longer reads it.
    [cards, config.palace_order, currentIndex, goToIndex, passedCardIds, refreshCanGoPrevious, scrollToIndex],
  )

  /**
   * 「上一张」: prefer view history so restudy/skip reorders still return to the
   * unit just left (even when that unit is no longer at index-1, or when the next
   * unit slid into index 0 and index-based back would stay disabled).
   */
  const navigatePrevious = useCallback(() => {
    if (ratingScope === 'palace') {
      const previousPalaceIndex = findPreviousPalaceIndex(cards, currentIndex)
      if (previousPalaceIndex != null) {
        navigateToIndex(previousPalaceIndex, { skipHistory: true, historical: true })
      }
      return
    }
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
  }, [cards, currentIndex, navigateToIndex, ratingScope])

  const navigateNext = useCallback(() => {
    if (ratingScope === 'palace') {
      const nextPalaceIndex = findNextPalaceIndex(cards, currentIndex)
      if (nextPalaceIndex == null) return
      if (
        isSequentialPalaceBlocked(
          cards,
          currentIndex,
          nextPalaceIndex,
          passedCardIds,
          config.palace_order,
        )
      ) {
        return
      }
      navigateToIndex(nextPalaceIndex)
      return
    }
    navigateToIndex(currentIndex + 1)
  }, [cards, config.palace_order, currentIndex, navigateToIndex, passedCardIds, ratingScope])

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
    if (
      isSequentialPalaceBlocked(
        cards,
        currentIndexRef.current,
        visual,
        passedCardIds,
        config.palace_order,
      )
    ) {
      setVisualIndex(currentIndexRef.current)
      visualIndexRef.current = currentIndexRef.current
      scrollToIndex(currentIndexRef.current, 'auto')
      return
    }
    if (visual !== currentIndexRef.current) {
      navigateToIndex(visual, { scroll: false, reorderRestudy: false })
    }
    const pinned = flushDeferredRestudy()
    setVisualIndex(pinned)
    visualIndexRef.current = pinned
    const node = scrollRef.current
    const pageHeight = pageHeightRef.current || node?.clientHeight || 0
    if (!node || !pageHeight) return
    const expectedTop = pinned * pageHeight
    if (Math.abs(node.scrollTop - expectedTop) > 2) {
      scrollToIndex(pinned, 'auto')
    }
  }, [cards, config.palace_order, flushDeferredRestudy, navigateToIndex, passedCardIds, scrollToIndex])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const updatePageHeight = () => {
      pageHeightRef.current = node.clientHeight
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

  useEffect(() => {
    const handlePageShow = () => {
      if (!isActive || loading || userScrollingRef.current) return
      scrollToIndex(currentIndexRef.current, 'auto')
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [isActive, loading, scrollToIndex])

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
    (cardId: string, options?: { restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }) => {
      // A previous failed mutation must not disable the rest of this round.
      // The card-level diagnostic remains visible until dismissed, while a
      // subsequent successful settlement clears the transient banner.
      setSaveError('')
      // A passed unit marks completedIds and rebuilds silently; stay on card.
      // Weak ratings (restudy) skip completedIds; never auto-flip to the next unit.
      completeCard(cardId, options)
    },
    [completeCard],
  )

  const handleBatchCardsSettled = useCallback(
    (
      entries: Array<{ cardId: string; restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }>,
    ) => {
      setSaveError('')
      completeCardBatch(entries, entries[0]?.cardId)
    },
    [completeCardBatch],
  )

  const recordChannelSample = useCallback((cardId: string, rating: UnitRating) => {
    setChannelLog((current) => recordChannelRating(current, cardId, rating))
  }, [])

  /**
   * Opt-in auto-advance. Passing rates only: a weak rate leaves the learner on the
   * card they still need to look at (and triggers a silent restudy rebuild, which
   * must not race a page turn). The delay lets the undo chip register before leaving.
   */
  const handleRatingSettled = useCallback(
    (cardId: string, passed: boolean, rating: UnitRating) => {
      // Feed the challenge–skill channel first: it must see every rate, including the
      // weak ones that never reach the auto-advance path below.
      recordChannelSample(cardId, rating)
      if (!autoAdvance || !passed) return
      if (autoAdvanceTimerRef.current != null) {
        window.clearTimeout(autoAdvanceTimerRef.current)
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null
        // A dialog opened during the delay owns the screen; turning the feed behind
        // it would drop the learner on a different card when they close it.
        if (isFreestyleOverlayOpen()) return
        // Resolve the index at fire time: settling may have reordered the feed.
        const list = queueRef.current
        const index = list.findIndex((card) => card.id === cardId)
        if (index < 0 || index !== currentIndexRef.current) return
        const rated = new Set(
          getFreestyleRatedCardIds(
            list,
            queueStateRef.current.completedIds,
            queueStateRef.current.unitEncountersByCardId,
          ),
        )
        const next = ratingScope === 'palace'
          ? findNextPalaceIndex(list, index)
          : list.findIndex((item, itemIndex) => itemIndex > index && !rated.has(item.id))
        if (next != null && next >= 0) navigateToIndex(next)
      }, AUTO_ADVANCE_DELAY_MS)
    },
    [autoAdvance, navigateToIndex, ratingScope, recordChannelSample],
  )

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current != null) {
        window.clearTimeout(autoAdvanceTimerRef.current)
      }
    }
  }, [])

  const handleStaleDrop = useCallback(
    (cardId: string) => {
      // Do not mark completed — still-due units must stay eligible (vs Insights queue).
      dropStaleCard(cardId)
      toast.info('这张已在其他设备复习，或内容刚被改过')
    },
    [dropStaleCard],
  )

  const handleCardSaveFailed = useCallback((message: string) => {
    setSaveError(message)
    toast.error(message)
  }, [])

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
    () => visibleMountIndices(visualIndex, cards.length),
    [cards.length, visualIndex],
  )

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (programmaticScrollRef.current) return
      const element = event.currentTarget
      const pageHeight = pageHeightRef.current || element.clientHeight
      if (!pageHeight || cards.length === 0) return
      userScrollingRef.current = true
      const nextIndex = Math.max(
        0,
        Math.min(cards.length - 1, Math.round(element.scrollTop / pageHeight)),
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
    [cards.length, flushScrollSettled],
  )

  /**
   * 「下个宫殿」reorders the feed under the current slot (nextIndex often equals
   * currentIndex). Force an auto scroll after paint so snap / scroll-anchoring
   * cannot keep the previous card in view — that looked like「下一题」.
   */
  const handleSkipToNextPalace = useCallback(() => {
    setReadOnlyHistoryCardId(null)
    const nextPalaceIndex = findNextPalaceIndex(cards, currentIndex)
    if (
      nextPalaceIndex != null
      && isSequentialPalaceBlocked(
        cards,
        currentIndex,
        nextPalaceIndex,
        passedCardIds,
        config.palace_order,
      )
    ) {
      // Reason is already on the card; the button is disabled with the same hint.
      return
    }
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
    // Same as navigateToIndex: the blocked reason is rendered on the card, not here.
  }, [cards, config.palace_order, currentIndex, passedCardIds, refreshCanGoPrevious, scrollToIndex, skipToNextPalace])

  const handleGoToPreviousPalace = useCallback(() => {
    const previousPalaceIndex = findPreviousPalaceIndex(cards, currentIndex)
    if (previousPalaceIndex == null) return
    navigateToIndex(previousPalaceIndex, { skipHistory: true, historical: true })
  }, [cards, currentIndex, navigateToIndex])

  const canGoPreviousPalace = findPreviousPalaceIndex(cards, currentIndex) != null
  const nextPalaceIndex = findNextPalaceIndex(cards, currentIndex)
  const canGoNextPalace =
    nextPalaceIndex != null
    && !isSequentialPalaceBlocked(
      cards,
      currentIndex,
      nextPalaceIndex,
      passedCardIds,
      config.palace_order,
    )

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
        navigateNext()
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        navigatePrevious()
      }
    },
    [navigateNext, navigatePrevious],
  )

  const progressSummary = useMemo(
    () => buildFreestyleProgressSummary(
      cards,
      roundPlan,
      queueState.completedIds,
      queueState.hiddenIds,
      currentCard?.id ?? null,
    ),
    [cards, currentCard?.id, queueState.completedIds, queueState.hiddenIds, roundPlan],
  )

  /**
   * Why 「下一组」 is unavailable, stated on the card instead of a toast: the old
   * toast listed unit names and fired exactly when the learner tried to move on.
   */
  const sequentialBlockedHint = useMemo(() => {
    if (cards.length === 0 || nextPalaceIndex == null || canGoNextPalace) return null
    const pending = getIncompleteUnitSummary(cardPalaceId(cards[currentIndex])).length
    if (pending === 0) return null
    return `还有 ${pending} 个单元未评分，忘记/困难会安排稍后重练`
  }, [canGoNextPalace, cards, currentIndex, getIncompleteUnitSummary, nextPalaceIndex])

  const roundComplete = isFreestyleRoundComplete(
    cards,
    queueState.unitEncountersByCardId,
    queueState.completedIds,
  )
  const seekLiveCardId = useCallback((cardId: string) => {
    const index = cards.findIndex((card) => card.id === cardId)
    if (index >= 0) navigateToIndex(index, { reorderRestudy: false })
  }, [cards, navigateToIndex])
  const applyLiveQuestionState = useCallback((questionId: number, state: QuizRuntimeState) => {
    updateQuestionState(questionId, (current) => (
      JSON.stringify(current) === JSON.stringify(state) ? current : state
    ))
  }, [updateQuestionState])
  const applyLiveAnkiFlip = useCallback((flip: FreestyleAnkiFlipLiveState | null) => {
    setLiveAnkiFlip((current) => (
      JSON.stringify(current) === JSON.stringify(flip) ? current : flip
    ))
  }, [])
  const applyLiveRevealMap = useCallback((map: Record<string, string> | null) => {
    setLiveRevealMap((current) => (
      JSON.stringify(current) === JSON.stringify(map) ? current : map
    ))
  }, [])
  const queueCardIds = useMemo(() => cards.map((card) => card.id), [cards])
  useFreestyleLiveMirror({
    route: fullPath,
    palaceId: entryPalaceId,
    currentCardId: currentCard?.id ?? null,
    currentIndex,
    queueCardIds,
    roundComplete,
    questionId: currentCard && isQuizCard(currentCard) ? currentCard.question.id : null,
    questionState: currentCard && isQuizCard(currentCard)
      ? progress.questionStates[currentCard.question.id]
      : undefined,
    ankiFlip: liveAnkiFlip,
    revealMap: liveRevealMap,
    seekCardId: seekLiveCardId,
    applyQuestionState: applyLiveQuestionState,
    applyAnkiFlip: applyLiveAnkiFlip,
    applyRevealMap: applyLiveRevealMap,
    isActive,
  })
  const roundCompletion = useMemo(
    () => buildFreestyleRoundCompletion(
      cards,
      queueState.unitEncountersByCardId,
      roundMeta.candidate_count,
      {
        completedIds: queueState.completedIds,
        scheduledCount: roundMeta.scheduled_count || roundPlan?.scheduledCount,
      },
    ),
    [
      cards,
      queueState.completedIds,
      queueState.unitEncountersByCardId,
      roundMeta.candidate_count,
      roundMeta.scheduled_count,
      roundPlan?.scheduledCount,
    ],
  )

  const channelReading = useMemo(
    () => readChallengeChannel(channelLogSamples(channelLog)),
    [channelLog],
  )

  const activeChannelAdjustment = useMemo(
    () => channelAdjustment(channelReading, config),
    [channelReading, config],
  )

  /**
   * The hint appears only at the two exits from the channel, only when there is an
   * actual correction to offer, and not again within the cooldown after a dismissal —
   * a suggestion the learner already declined becomes an interruption if it returns.
   */
  const channelHintVisible = Boolean(
    shouldSurfaceChannelHint(channelReading)
    && activeChannelAdjustment
    && cards.length > 0
    && !roundComplete
    && !loading
    && !error
    && !channelHintSuppressed,
  )

  useEffect(() => {
    if (loading || error || cards.length === 0) {
      setPalaceClearance(null)
      return
    }
    const card = cards[currentIndex]
    const palaceId = cardPalaceId(card)
    if (palaceId == null || !card) {
      setPalaceClearance(null)
      return
    }
    const key = `${queueState.roundId}:${palaceId}`
    const cleared = isPalaceRoundCleared({
      cards,
      palaceId,
      plan: roundPlan,
      encountersByCardId: queueState.unitEncountersByCardId,
      completedIds: queueState.completedIds,
      pendingRestudyIds: pendingRestudyCardIds,
      hiddenIds: queueState.hiddenIds,
    })
    if (!cleared) {
      setPalaceClearance(null)
      return
    }
    if (announcedPalaceClearanceRef.current === key) return
    announcedPalaceClearanceRef.current = key
    const clearance = buildPalaceClearance(
      cards,
      palaceId,
      leftoverDueForPalace(roundMeta.palace_leftover_due, palaceId),
    )
    setPalaceClearance(clearance)
    signalPalaceCleared()
  }, [
    cards,
    currentIndex,
    error,
    loading,
    pendingRestudyCardIds,
    queueState.completedIds,
    queueState.hiddenIds,
    queueState.roundId,
    queueState.unitEncountersByCardId,
    roundMeta.palace_leftover_due,
    roundPlan,
    signalPalaceCleared,
  ])

  /**
   * Apply the correction without leaving the feed. Silent + preferCardId so the round
   * keeps its finished work and the learner stays on the card under the viewport: the
   * correction has to cost less attention than the drift it fixes.
   */
  const suppressChannelHint = useCallback(() => {
    setChannelHintSuppressed(true)
    if (channelHintCooldownRef.current != null) {
      window.clearTimeout(channelHintCooldownRef.current)
    }
    channelHintCooldownRef.current = window.setTimeout(() => {
      channelHintCooldownRef.current = null
      setChannelHintSuppressed(false)
    }, CHANNEL_HINT_COOLDOWN_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (channelHintCooldownRef.current != null) {
        window.clearTimeout(channelHintCooldownRef.current)
      }
    }
  }, [])

  const handleApplyChannelAdjustment = useCallback(() => {
    if (!activeChannelAdjustment) return
    setChannelAdjusting(true)
    suppressChannelHint()
    // The reading described the round before this change; keeping it would have the
    // hint immediately re-offer the same correction.
    setChannelLog(EMPTY_CHANNEL_LOG)
    setConfigAndPersist(activeChannelAdjustment.apply, {
      silent: true,
      preferCardId: currentCard?.id ?? null,
    })
    setChannelAppliedHint('未做部分已按更易/更难重排，已完成保留')
    setChannelAdjusting(false)
  }, [activeChannelAdjustment, currentCard?.id, setConfigAndPersist, suppressChannelHint])

  const mindmapCount = cards.filter(isMindMapBranchCard).length
  const quizCount = cards.filter(isQuizCard).length
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
          // Flat near-black: the old top-center green glow pulled the eye up and away
          // from the card. A quiet field keeps attention on the map.
          'bg-[#0b0c0e]',
          // Immersive freestyle hides mobile bottom nav; use almost full viewport height on phone.
          'h-[calc(100dvh-env(safe-area-inset-bottom,0px))] min-h-0 rounded-xl border border-white/5 shadow-2xl max-lg:rounded-none max-lg:border-0 lg:h-[calc(100vh-88px)]',
          freestyleFullscreen && 'fixed inset-0 z-[80] h-[100dvh] max-w-none rounded-none border-0 shadow-none',
        )}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <FreestyleRoundSheet
          open={planOpen}
          cards={cards}
          currentIndex={currentIndex}
          queueState={queueState}
          roundPlan={roundPlan}
          queueLimit={config.queue_length}
          onOpenChange={setPlanOpen}
          onJump={(cardId) => {
            const index = cards.findIndex((card) => card.id === cardId)
            if (index < 0) return
            setPlanOpen(false)
            navigateToIndex(index)
          }}
          onExclude={excludePlanCards}
          onRestore={restorePlanCards}
          onReorder={reorderPlan}
          onResetRound={reshuffleQueue}
          onOpenConfig={() => {
            setPlanOpen(false)
            setConfigOpen(true)
          }}
          loading={loading}
        />
        <FreestyleRoundConfigDialog
          open={configOpen}
          config={config}
          onOpenChange={setConfigOpen}
          onSaveConfig={saveFreestyleConfig}
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

        <FreestyleProgressRail
          summary={progressSummary}
          timerStatus={timer.status}
          effectiveSeconds={timer.effectiveSeconds}
          onOpenPlan={() => setPlanOpen(true)}
          onTimerToggle={() => {
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
          overflow={(
            <>
              <button
                type="button"
                className={cn(hudActionClass, 'text-zinc-300 hover:text-white')}
                title="本轮安排"
                aria-label="本轮安排"
                onClick={() => setPlanOpen(true)}
              >
                <ListChecks className="size-4" />
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
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {cards.length === 0
                      ? `本轮 0 张 · 候选 ${roundMeta.candidate_count} · 上限 ${roundMeta.queue_limit}`
                      : `导图 ${mindmapCount} · 题 ${quizCount}${resolvedQuiz > 0 ? ` · 已答 ${resolvedQuiz}` : ''} · 候选 ${roundMeta.candidate_count}`}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => refreshQueue()}>
                    <RefreshCw className="mr-2 size-4" />
                    刷新队列
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                    <History className="mr-2 size-4" />
                    历史
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
            </>
          )}
        />

        {!yesterdayHintDismissed && isQueueStateFromPreviousDay(queueState) ? (
          <div
            data-testid="freestyle-yesterday-hint"
            className="absolute left-1/2 top-[4.25rem] z-30 flex max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-950/92 px-3 py-2 text-xs text-amber-50 shadow-lg"
          >
            <span>这是昨天未完成的一轮</span>
            <button type="button" className="underline" onClick={() => setYesterdayHintDismissed(true)}>
              知道了
            </button>
          </div>
        ) : null}

        {channelAppliedHint ? (
          <div
            data-testid="freestyle-channel-applied"
            className="absolute left-1/2 top-[4.25rem] z-30 flex max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/15 bg-zinc-950/92 px-3 py-2 text-xs text-zinc-100 shadow-lg"
          >
            <span>{channelAppliedHint}</span>
            <button type="button" className="underline" onClick={() => setChannelAppliedHint('')}>
              关闭
            </button>
          </div>
        ) : null}

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

        {palaceClearance ? <FreestylePalaceClearedBanner clearance={palaceClearance} /> : null}

        {channelHintVisible && activeChannelAdjustment ? (
          <FreestyleChannelHint
            state={channelReading.state as 'anxious' | 'bored'}
            hint={activeChannelAdjustment.hint}
            actionLabel={activeChannelAdjustment.actionLabel}
            busy={channelAdjusting || loading}
            onApply={handleApplyChannelAdjustment}
            onDismiss={suppressChannelHint}
          />
        ) : null}

        <div
          ref={scrollRef}
          data-page-history-scroll-key="freestyle-immersive"
          // overflow-anchor-none: reordering cards for「下个宫殿」must not let the
          // browser keep the old card glued to the viewport (looks like no jump).
          className="h-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-contain [overflow-anchor:none] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          onScroll={handleScroll}
        >
          {loading ? (
            <FreestyleLoadingState />
          ) : error ? (
            <FreestyleFeedErrorState
              feedError={error}
              mode="free"
              config={config}
              onLoadFeed={async () => { refreshQueue() }}
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
              // Empty round: the useful surface is config, not an empty plan list.
              onOpenSettings={() => setConfigOpen(true)}
              completedCount={queueState.completedIds.length}
              mutedCount={queueState.mutedPalaceIds.length}
              hiddenCount={queueState.hiddenIds.length}
            />
          ) : (
            cards.map((card, index) => {
              const planEntry = roundPlan?.cardsById[card.id]
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
                    'relative box-border flex h-full min-h-full flex-col snap-start snap-always',
                    // Only the 2px rail needs clearance now that the card header is gone;
                    // the title/flip chip floats inside the map surface.
                    'px-1.5 pb-1.5 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] sm:px-2.5 sm:pb-2.5 sm:pt-6',
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
                          fullscreen={freestyleFullscreen && index === currentIndex}
                          onToggleFullscreen={(next) => {
                            setFreestyleFullscreen(next ?? !freestyleFullscreen)
                          }}
                          freestyleFlipMode={flipMode}
                          onFreestyleFlipModeChange={updateFlipMode}
                          autoAdvance={autoAdvance}
                          onAutoAdvanceChange={updateAutoAdvance}
                          preferredZoom={mindmapZoom}
                          onUserZoomChange={updateMindmapZoom}
                          blockedHint={index === currentIndex ? sequentialBlockedHint : null}
                          onRatingSettled={handleRatingSettled}
                          ratingScope={ratingScope}
                          onRatingScopeChange={updateRatingScope}
                          palaceTarget={index === currentIndex ? palaceRatingTarget : null}
                          onBatchCardsSettled={handleBatchCardsSettled}
                          onEnsureEncounter={ensureUnitEncounter}
                          onEncounterChange={updateUnitEncounter}
                          onBranchComplete={handleBranchComplete}
                          onStaleDrop={handleStaleDrop}
                          onSaveFailed={handleCardSaveFailed}
                          onUnitsReconciled={() => {
                            void buildQueue(config, {
                              preserveCompleted: true,
                              silent: true,
                              preferCardId: card.id,
                            })
                          }}
                          liveRevealMap={index === currentIndex ? liveRevealMap : null}
                          onLiveRevealMapChange={applyLiveRevealMap}
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
                        flipState={
                          liveAnkiFlip?.cardId === card.id
                            ? {
                                flipped: liveAnkiFlip.flipped,
                                revealedBacks: liveAnkiFlip.revealedBacks,
                                focusUid: liveAnkiFlip.focusUid,
                              }
                            : undefined
                        }
                        onFlipStateChange={(next) => {
                          setLiveAnkiFlip({ cardId: card.id, ...next })
                        }}
                      />
                    )
                  ) : isQuizCard(card) ? (
                    <FreestyleQuizCardView
                      card={card}
                      active={isActive && index === currentIndex}
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
                  <FreestyleRetryCornerBadge
                    card={card}
                    retryAfterCards={planEntry?.status === 'retry' ? planEntry.retryAfterCards : undefined}
                  />
                </div>
              )
            })
          )}
          {/* Closing slot, appended rather than replacing the feed so 回看 still works. */}
          {!loading && !error && roundComplete ? (
            <div className="relative box-border flex h-full min-h-full flex-col snap-start snap-always px-1.5 pb-1.5 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] sm:px-2.5 sm:pb-2.5 sm:pt-6">
              <FreestyleRoundCompleteCard
                completion={roundCompletion}
                durationSeconds={timer.effectiveSeconds}
                loading={loading}
                onNextRound={reshuffleQueue}
                onOpenConfig={() => setConfigOpen(true)}
                onReviewRound={() => navigateToIndex(0, { historical: true, skipHistory: true })}
              />
            </div>
          ) : null}
        </div>

        {/*
          Prev/next stay on PWA: one-finger swipe over the map still misses snap.
          Palace skip stays desktop-only so the phone dock is two large targets.
        */}
        <FreestyleFeedPager
          canGoPrevious={
            ratingScope === 'palace'
              ? canGoPreviousPalace
              : canGoPrevious && cards.length > 0
          }
          canGoNext={
            ratingScope === 'palace'
              ? canGoNextPalace
              : cards.length > 0 && currentIndex < cards.length - 1
          }
          canGoPreviousPalace={canGoPreviousPalace}
          canGoNextPalace={canGoNextPalace}
          sequentialBlockedHint={sequentialBlockedHint}
          palaceMode={ratingScope === 'palace'}
          onPrevious={navigatePrevious}
          onNext={navigateNext}
          onPreviousPalace={handleGoToPreviousPalace}
          onSkipPalace={handleSkipToNextPalace}
        />
      </div>
    </TooltipProvider>
  )
}
