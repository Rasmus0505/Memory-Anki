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
import {
  buildFreestyleProgressSummary,
  liveEncounterFillDone,
  retryChromeClass,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import {
  buildFreestyleRoundCompletion,
  clampFreestyleFeedIndex,
  findEarliestUnhandledIndex,
  freestyleCanPageNext,
  freestyleFeedSlotCount,
  isFreestyleCompleteSlot,
  isFreestyleRoundComplete,
  resolveFreestyleCompleteSeek,
} from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleRoundConfigDialog } from '@/modules/practice/ui/freestyle/components/FreestyleRoundConfigDialog'
import { overlayQuizRangeLabel, overlayReviewPalaceIds } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { FreestyleScopeQuizDialog } from '@/modules/practice/ui/freestyle/components/FreestyleDialogsHost'
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
import {
  type FreestyleLiveRating,
} from '@/modules/practice/ui/freestyle/model/freestyleLiveView'
import type { FreestyleAnkiFlipLiveState } from '@/modules/practice/ui/freestyle/model/freestyleLiveView'
import {
  readFreestyleRevealMap,
  writeFreestyleRevealMap,
} from '@/modules/practice/ui/freestyle/model/freestyleRevealCache'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { parseFreestyleEntryPalaceId } from '@/modules/practice/ui/freestyle/model/freestyle-entry-scope'
import {
  flattenPalaceOptions,
  isMindMapBranchCard,
  isQuizCard,
} from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { getPalacesGroupedApi } from '@/modules/content/public'
import {
  getFreestyleQuestionDirection,
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
  RESTUDY_MAX_INTERVENING,
  popViewHistory,
  pushViewHistory,
  visibleMountIndices,
  FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  FREESTYLE_WORKSPACE_PRIMARY,
  FREESTYLE_WORKSPACE_SECONDARY,
  isQueueStateFromPreviousDay,
  type FreestyleFlipMode,
  type FreestyleWorkspaceId,
  type UnitRating,
  freestyleWorkspaceLabel,
  freestyleWorkspacePath,
  normalizeFreestyleWorkspaceId,
  peerFreestyleWorkspace,
  readFreestyleDisplaySettings,
  readFreestyleFeedConfig,
  sanitizeFreestyleDisplaySettings,
  saveFreestyleDisplaySettings,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig, FreestyleQuizCard } from '@/shared/api/contracts'
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

const FREESTYLE_STALE_TOAST_ID = 'freestyle-stale-card'

const FREESTYLE_SECTION_LINKS = [
  { to: '/palaces', label: '知识' },
  { to: '/english', label: '英语' },
  { to: '/palaces/new', label: '创建' },
  { to: '/dashboard', label: '洞察' },
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

function FreestyleRetryCornerBadge({
  card,
  retryAfterCards,
  completed,
}: {
  card: FreestyleCard
  retryAfterCards?: number
  completed: boolean
}) {
  const isRetry = card.occurrence_kind === 'retry'
  const isSourceRetry = !isRetry && retryAfterCards != null
  if (!isRetry && !isSourceRetry) return null
  const done = isRetry && completed
  const label = isRetry
    ? (done
      ? `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次 · 已过`
      : `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次`)
    : `${Math.max(0, retryAfterCards ?? 3)} 张后重练`
  return (
    <div
      data-testid="freestyle-retry-corner-badge"
      data-completed={done ? 'true' : 'false'}
      role="status"
      // Left, under the title chip: the mobile nav dock this used to dodge is gone,
      // the bottom edge belongs to the rating bar, and the top-right holds the
      // timer dot + overflow.
      className={cn(
        'pointer-events-none absolute left-4 top-[calc(3.25rem+env(safe-area-inset-top,0px))] z-30 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-lg backdrop-blur-sm sm:top-14',
        retryChromeClass(done),
      )}
    >
      <span aria-hidden>{isRetry ? '↻' : '·'}</span>
      {label}
    </div>
  )
}

export default function ImmersiveFreestylePage({
  workspace = FREESTYLE_WORKSPACE_PRIMARY,
}: {
  workspace?: FreestyleWorkspaceId
} = {}) {
  const slot = normalizeFreestyleWorkspaceId(workspace)
  const workspacePath = freestyleWorkspacePath(slot)
  const workspaceTitle = slot === FREESTYLE_WORKSPACE_SECONDARY ? '随心 2' : '随心模式'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const entryPalaceId = parseFreestyleEntryPalaceId(searchParams.toString())
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  useFreestyleWakeLock(isActive)
  useFreestyleChromeTheme(isActive)
  const reducedMotion = usePrefersReducedMotion()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const queueRef = useRef<FreestyleCard[]>([])
  const queueFrozenRef = useRef(false)
  const planVersionRef = useRef(0)
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
  const roundCompleteRef = useRef(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  /** Settlement 「再来一轮」 opens config in nextRound mode; HUD uses replan. */
  const [configIntent, setConfigIntent] = useState<'replan' | 'nextRound'>('replan')
  const [subjectByPalaceId, setSubjectByPalaceId] = useState<
    ReadonlyMap<number, { id: number; name: string }>
  >(() => new Map())
  const [scopeQuizOpen, setScopeQuizOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [flipMode, setFlipMode] = useState<FreestyleFlipMode>(
    () => readFreestyleDisplaySettings().flip_mode,
  )
  const [liveAnkiFlip, setLiveAnkiFlip] = useState<FreestyleAnkiFlipLiveState | null>(null)
  const [liveRevealMap, setLiveRevealMap] = useState<Record<string, string> | null>(null)
  const seededRevealCardIdRef = useRef<string | null>(null)
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
  const [inlineEditing, setInlineEditing] = useState(false)

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
    startNextRound,
    reshuffleQueue,
    completeCard,
    completeCardBatch,
    acknowledgeCard,
    ensureUnitEncounter,
    updateUnitEncounter,
    dropStaleCard,
    adoptLiveUnitRevision,
    staleCircuitOpen,
    staleRecoveryCardId,
    resetStaleRecovery,
    reorderPlan,
    excludePlanCards,
    restorePlanCards,
    buildQueue,
    pendingRestudyCardIds,
    planVersion,
    adoptRoundVersion,
    queueFrozen,
  } = useImmersiveQueue(entryPalaceId, slot)
  const queueStateRef = useRef(queueState)
  const { signalPalaceCleared } = useFreestyleFlowFeedback()

  useEffect(() => {
    return onAppEvent(FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT, (detail) => {
      const settings = sanitizeFreestyleDisplaySettings(detail)
      setFlipMode(settings.flip_mode)
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

  const updateMindmapZoom = useCallback((next: number) => {
    const saved = saveFreestyleDisplaySettings({ mindmap_zoom: next })
    setMindmapZoom(saved.mindmap_zoom)
  }, [])

  const saveFreestyleConfig = useCallback((nextConfig: FreestyleFeedConfig) => {
    resetStaleRecovery()
    if (configIntent === 'nextRound') {
      startNextRound(nextConfig)
      setConfigIntent('replan')
    } else {
      setConfigAndPersist(nextConfig)
    }
    // A shelf link is a launch hint. Remove it after saving so refresh cannot
    // reapply the old single-palace scope over the saved selection.
    if (entryPalaceId != null) navigate(workspacePath, { replace: true })
  }, [
    configIntent,
    entryPalaceId,
    navigate,
    resetStaleRecovery,
    setConfigAndPersist,
    startNextRound,
    workspacePath,
  ])

  useEffect(() => {
    let active = true
    void getPalacesGroupedApi().then((value) => {
      if (!active) return
      const map = new Map<number, { id: number; name: string }>()
      for (const palace of flattenPalaceOptions(value)) {
        const subject = palace.subject
        if (!subject?.id || !subject.name) continue
        map.set(palace.id, { id: subject.id, name: subject.name })
      }
      setSubjectByPalaceId(map)
    }).catch(() => {
      if (active) setSubjectByPalaceId(new Map())
    })
    return () => { active = false }
  }, [])

  queueRef.current = cards
  queueFrozenRef.current = queueFrozen
  planVersionRef.current = planVersion
  currentIndexRef.current = currentIndex
  queueStateRef.current = queueState
  visualIndexRef.current = visualIndex
  const currentCard = cards[currentIndex] ?? null
  const roundComplete = isFreestyleRoundComplete(
    cards,
    queueState.unitEncountersByCardId,
    queueState.completedIds,
    roundPlan,
  )
  roundCompleteRef.current = roundComplete
  const viewingCompleteSlot = isFreestyleCompleteSlot(visualIndex, cards.length, roundComplete)
  const currentCardId = currentCard?.id ?? null
  const revealCacheKey = currentCardId
  if (seededRevealCardIdRef.current !== revealCacheKey) {
    seededRevealCardIdRef.current = revealCacheKey
    setLiveRevealMap(revealCacheKey ? readFreestyleRevealMap(revealCacheKey) : null)
  }
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

  useEffect(() => {
    setInlineEditing(false)
  }, [currentIndex])

  useEffect(() => {
    announcedPalaceClearanceRef.current = null
    setPalaceClearance(null)
  }, [queueState.roundId])

  const timer = useTimedSession({
    sessionKey: slot === FREESTYLE_WORKSPACE_SECONDARY ? 'freestyle-secondary' : 'freestyle',
    kind: 'quiz',
    title: workspaceTitle,
    palaceId: null,
    automationScene: 'freestyle',
    sourceKind: null,
    persistKey: slot === FREESTYLE_WORKSPACE_SECONDARY ? 'freestyle-immersive-secondary' : 'freestyle-immersive',
    persistCompletionRecord: false,
  })

  useGlobalTimerRegistration({
    scene: 'freestyle',
    title: workspaceTitle,
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
    }
  }, [cards, currentIndex, navigateToIndex, roundComplete])

  const navigateNext = useCallback(() => {
    if (isFreestyleCompleteSlot(visualIndexRef.current, cards.length, roundComplete)) return
    const from = visualIndexRef.current
    const currentId = cards[from]?.id ?? null
    const pendingOnCurrent = Boolean(
      currentId && pendingRestudyCardIds.includes(currentId),
    )
    // Last card still holding an uninserted retry: leave/insert then land on it.
    if (!roundComplete && from >= cards.length - 1 && pendingOnCurrent) {
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
    navigateToIndex(from + 1)
  }, [
    cards,
    goToIndex,
    navigateToIndex,
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
    const node = scrollRef.current
    const pageHeight = pageHeightRef.current || node?.clientHeight || 0
    if (!node || !pageHeight) return
    const expectedTop = pinned * pageHeight
    if (Math.abs(node.scrollTop - expectedTop) > 2) {
      scrollToIndex(pinned, 'auto')
    }
  }, [flushDeferredRestudy, navigateToIndex, scrollToIndex])

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
    if (queueFrozen) return
    if (userScrollingRef.current || programmaticScrollRef.current) return
    if (indexChangeFromScrollRef.current) {
      indexChangeFromScrollRef.current = false
      return
    }
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

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current != null) {
      window.clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  const handleBranchComplete = useCallback(
    (cardId: string, options?: { restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }) => {
      // A previous failed mutation must not disable the rest of this round.
      // The card-level diagnostic remains visible until dismissed, while a
      // subsequent successful settlement clears the transient banner.
      setSaveError('')
      if (options?.cleared) cancelAutoAdvance()
      // A passed unit marks completedIds and rebuilds silently; stay on card.
      // Weak ratings (restudy) skip completedIds; never auto-flip to the next unit.
      completeCard(cardId, options)
    },
    [cancelAutoAdvance, completeCard],
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
    (
      cardId: string,
      _passed: boolean,
      rating: UnitRating,
      _meta?: { occurrenceId?: string; encounterId?: string; planVersion?: number },
    ) => {
      // Feed the challenge–skill channel first: it must see every rate, including the
      // weak ones that never reach the auto-advance path below.
      recordChannelSample(cardId, rating)
    },
    [recordChannelSample],
  )

  useEffect(() => {
    return () => {
      cancelAutoAdvance()
    }
  }, [cancelAutoAdvance])

  const handleStaleDrop = useCallback(
    (cardId: string) => {
      // Do not mark completed — still-due units must stay eligible (vs Insights queue).
      const result = dropStaleCard(cardId)
      if (result.shouldToast) {
        toast.info('这张已在其他设备复习，或内容刚被改过', { id: FREESTYLE_STALE_TOAST_ID })
        return
      }
      if (result.circuitOpen) {
        toast.dismiss(FREESTYLE_STALE_TOAST_ID)
      }
    },
    [dropStaleCard],
  )

  const handleSkipStaleRecovery = useCallback(() => {
    const cardId = staleRecoveryCardId ?? cards[currentIndex]?.id
    toast.dismiss(FREESTYLE_STALE_TOAST_ID)
    if (cardId) dropStaleCard(cardId, { force: true })
  }, [cards, currentIndex, dropStaleCard, staleRecoveryCardId])

  const handleRebuildStaleRecovery = useCallback(() => {
    toast.dismiss(FREESTYLE_STALE_TOAST_ID)
    refreshQueue()
  }, [refreshQueue])

  const handleOpenStaleConfig = useCallback(() => {
    setConfigIntent('replan')
    setConfigOpen(true)
  }, [])

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
    [cards.length, flushScrollSettled, roundComplete],
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

  const viewingCardId = viewingCompleteSlot ? null : (cards[visualIndex]?.id ?? null)
  const progressSummary = useMemo(
    () => buildFreestyleProgressSummary(
      cards,
      roundPlan,
      queueState.completedIds,
      queueState.hiddenIds,
      viewingCardId,
      queueState.unitEncountersByCardId,
    ),
    [
      cards,
      queueState.completedIds,
      queueState.hiddenIds,
      queueState.unitEncountersByCardId,
      roundPlan,
      viewingCardId,
    ],
  )
  const earliestUnhandledIndex = useMemo(
    () => findEarliestUnhandledIndex(
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
    : '定位到最早还没完成的单元'
  const handleCompleteRound = useCallback(() => {
    if (completeSeekIndex == null) return
    navigateToIndex(completeSeekIndex, { skipHistory: true })
  }, [completeSeekIndex, navigateToIndex])

  const sequentialBlockedHint = null

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
    setLiveRevealMap((current) => {
      if (JSON.stringify(current) === JSON.stringify(map)) return current
      if (map && revealCacheKey) writeFreestyleRevealMap(revealCacheKey, map)
      return map
    })
  }, [revealCacheKey])
  const liveRating = useMemo<FreestyleLiveRating | null>(() => {
    const settled = Object.entries(queueState.unitEncountersByCardId).flatMap(([cardId, encounter]) => {
      if (encounter.selectedRating == null) return []
      return [{
        cardId,
        rating: encounter.selectedRating,
        passed: encounter.passed === true,
        restudy: encounter.passed === false,
        retryAfterCards: encounter.retryAfterCards ?? 0,
      }]
    })
    const currentId = currentCard?.id ?? null
    const current = currentId ? queueState.unitEncountersByCardId[currentId] : undefined
    if (current?.selectedRating == null && settled.length === 0) return null
    return {
      planVersion,
      currentCardId: currentId,
      selectedRating: current?.selectedRating ?? settled[0]?.rating ?? 0,
      passed: current?.passed === true,
      settled,
    }
  }, [currentCard?.id, planVersion, queueState.unitEncountersByCardId])
  const applyLiveRating = useCallback((rating: FreestyleLiveRating) => {
    if (rating.planVersion > 0) {
      adoptRoundVersion({ plan_version: rating.planVersion })
    }
    const entries = rating.settled.flatMap((settle) => {
      const current = queueStateRef.current.unitEncountersByCardId[settle.cardId]
      if (
        current?.selectedRating === settle.rating
        && current.passed === settle.passed
        && current.retryAfterCards === settle.retryAfterCards
      ) {
        return []
      }
      updateUnitEncounter(settle.cardId, {
        encounterId: current?.encounterId ?? settle.cardId,
        roundId: current?.roundId,
        unitRevision: current?.unitRevision ?? 0,
        status: current?.status ?? 'open',
        sessionId: current?.sessionId ?? null,
        selectedRating: settle.rating,
        passed: settle.passed,
        retryAfterCards: settle.retryAfterCards,
      })
      return [{
        cardId: settle.cardId,
        restudy: settle.restudy,
        rating: settle.rating,
        retryAfterCards: settle.retryAfterCards,
      }]
    })
    if (entries.length > 0) {
      completeCardBatch(entries, rating.currentCardId ?? undefined)
    }
  }, [adoptRoundVersion, completeCardBatch, updateUnitEncounter])
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
    rating: liveRating,
    seekCardId: seekLiveCardId,
    applyQuestionState: applyLiveQuestionState,
    applyAnkiFlip: applyLiveAnkiFlip,
    applyRevealMap: applyLiveRevealMap,
    applyRating: applyLiveRating,
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
        roundPlan,
        subjectByPalaceId,
        quizCount: new Set([
          ...cards.flatMap((card) => (
            isQuizCard(card) && (
              queueState.completedIds.includes(card.id)
              || answeredQuestionIds.has(card.question.id)
            )
              ? [card.question.id]
              : []
          )),
          ...answeredQuestionIds,
        ]).size,
      },
    ),
    [
      answeredQuestionIds,
      cards,
      queueState.completedIds,
      queueState.unitEncountersByCardId,
      roundMeta.candidate_count,
      roundMeta.scheduled_count,
      roundPlan,
      subjectByPalaceId,
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

  // Stable overflow tree: recreating DropdownMenuTrigger every parent render
  // under TooltipProvider loops Radix composeRefs (Vite Maximum update depth).
  const progressRailOverflow = useMemo(() => (
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
      <DropdownMenu modal={false}>
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
          <DropdownMenuItem asChild>
            <Link to={freestyleWorkspacePath(peerFreestyleWorkspace(slot))}>
              {freestyleWorkspaceLabel(peerFreestyleWorkspace(slot))}
            </Link>
          </DropdownMenuItem>
          {FREESTYLE_SECTION_LINKS.map((item) => (
            <DropdownMenuItem key={item.to} asChild>
              <Link to={item.to}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ), [
    cards.length,
    mindmapCount,
    quizCount,
    refreshQueue,
    resolvedQuiz,
    roundMeta.candidate_count,
    roundMeta.queue_limit,
    slot,
  ])

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative max-w-full overflow-hidden text-zinc-50',
          // Flat near-black: the old top-center green glow pulled the eye up and away
          // from the card. A quiet field keeps attention on the map.
          'bg-[#0b0c0e]',
          // Shell already fills the viewport on mind-map hosts; keep the feed flush.
          'flex h-full min-h-0 flex-1 flex-col rounded-none border-0',
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
          onOpenConfig={() => {
            setPlanOpen(false)
            setConfigIntent('replan')
            setConfigOpen(true)
          }}
          loading={loading}
        />
        <FreestyleRoundConfigDialog
          open={configOpen}
          config={config}
          mode={configIntent}
          onOpenChange={(open) => {
            setConfigOpen(open)
            if (!open) setConfigIntent('replan')
          }}
          onSaveConfig={saveFreestyleConfig}
        />
        <FreestyleScopeQuizDialog
          open={scopeQuizOpen}
          onOpenChange={setScopeQuizOpen}
          roundId={queueState.roundId}
          planVersion={planVersion}
          storedConfig={readFreestyleFeedConfig(slot)}
          setupDone={Boolean(readFreestyleFeedConfig(slot).overlay_quiz_setup_done)}
          rangeLabel={overlayQuizRangeLabel(overlayReviewPalaceIds(roundPlan).length)}
          onConfirmSetup={({ quizScope, overlayQuestionRange }) => {
            setConfigAndPersist((current) => ({
              ...current,
              overlay_quiz_setup_done: true,
              quiz_scope: quizScope,
              overlay_question_range: overlayQuestionRange,
              streams: {
                ...current.streams,
                quiz: {
                  ...current.streams.quiz,
                  quiz_scope: quizScope,
                  overlay_question_range: overlayQuestionRange,
                },
              },
            }))
          }}
          onRoundSync={adoptRoundVersion}
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
          workspaceSwitcher={(
            <div
              data-testid="freestyle-workspace-switcher"
              className="pointer-events-auto mr-1 inline-flex items-center rounded-full border border-white/10 bg-zinc-950/70 p-0.5 text-[11px] font-medium"
            >
              <Link
                to={freestyleWorkspacePath(FREESTYLE_WORKSPACE_PRIMARY)}
                className={cn(
                  'rounded-full px-2 py-0.5',
                  slot === FREESTYLE_WORKSPACE_PRIMARY ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white',
                )}
                aria-current={slot === FREESTYLE_WORKSPACE_PRIMARY ? 'page' : undefined}
              >
                {freestyleWorkspaceLabel(FREESTYLE_WORKSPACE_PRIMARY)}
              </Link>
              <Link
                to={freestyleWorkspacePath(FREESTYLE_WORKSPACE_SECONDARY)}
                className={cn(
                  'rounded-full px-2 py-0.5',
                  slot === FREESTYLE_WORKSPACE_SECONDARY ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white',
                )}
                aria-current={slot === FREESTYLE_WORKSPACE_SECONDARY ? 'page' : undefined}
              >
                {freestyleWorkspaceLabel(FREESTYLE_WORKSPACE_SECONDARY)}
              </Link>
            </div>
          )}
          onOpenPlan={() => setPlanOpen(true)}
          overflow={progressRailOverflow}
        />

        {!yesterdayHintDismissed && isQueueStateFromPreviousDay(queueState) ? (
          <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-30 max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2">
            <button
              type="button"
              data-testid="freestyle-yesterday-hint"
              className="pointer-events-auto rounded-2xl border border-amber-300/25 bg-amber-950/92 px-3 py-2 text-xs text-amber-50 shadow-lg"
              onClick={() => setYesterdayHintDismissed(true)}
            >
              这是昨天未完成的一轮
            </button>
          </div>
        ) : null}

        {channelAppliedHint ? (
          <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-30 max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2">
            <button
              type="button"
              data-testid="freestyle-channel-applied"
              className="pointer-events-auto rounded-2xl border border-white/15 bg-zinc-950/92 px-3 py-2 text-xs text-zinc-100 shadow-lg"
              onClick={() => setChannelAppliedHint('')}
            >
              {channelAppliedHint}
            </button>
          </div>
        ) : null}

        {saveError ? (
          <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-30 max-w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2">
            <button
              type="button"
              className="pointer-events-auto rounded-2xl border border-rose-400/30 bg-rose-950/95 px-4 py-2.5 text-sm text-rose-100 shadow-lg"
              onClick={() => setSaveError('')}
            >
              {saveError}
            </button>
          </div>
        ) : null}

        {palaceClearance ? (
          <FreestylePalaceClearedBanner
            clearance={palaceClearance}
            onDismiss={() => setPalaceClearance(null)}
          />
        ) : null}

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

        {staleCircuitOpen && currentCard?.id === staleRecoveryCardId ? (
          <div
            data-testid="freestyle-stale-recovery"
            role="region"
            aria-label="队列恢复"
            className="pointer-events-none absolute inset-x-0 top-16 bottom-24 z-[19] flex items-center justify-center px-4 pr-16"
          >
            <div className="pointer-events-auto flex max-w-[min(22rem,100%)] flex-col gap-3 rounded-2xl border border-amber-300/30 bg-zinc-950/94 px-4 py-3.5 text-sm text-amber-50 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
              <p>多张卡片已在其他设备复习，或内容刚被改过</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-amber-200/35 bg-amber-300/15 px-3 py-1.5 text-xs font-medium hover:bg-amber-300/25"
                  onClick={handleSkipStaleRecovery}
                >
                  跳过这张
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-white/20 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
                  onClick={handleRebuildStaleRecovery}
                >
                  重建队列
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-white/20 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
                  onClick={handleOpenStaleConfig}
                >
                  打开配置
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div
          ref={scrollRef}
          data-page-history-scroll-key="freestyle-immersive"
          // overflow-anchor-none: reordering cards for「下个宫殿」must not let the
          // browser keep the old card glued to the viewport (looks like no jump).
          data-testid="freestyle-feed-scroller"
          className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-contain [overflow-anchor:none] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          onScroll={handleScroll}
        >
          {cards.length > 0 ? (
            cards.map((card, index) => {
              const planEntry = roundPlan?.cardsById[card.id]
              if (!mounted.has(index)) {
                return (
                  <div
                    key={card.id}
                    className="h-full min-h-0 shrink-0 snap-start snap-always"
                    aria-hidden
                  />
                )
              }
              return (
                <div
                  key={card.id}
                  className={cn(
                    'relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always',
                    // Keep the 6px progress rail on the dark shell so it stays readable
                    // on PWA; the title/flip chip floats inside the map surface.
                    'p-0 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)]',
                  )}
                >
                  {isMindMapBranchCard(card) ? (
                    card.type === 'mindmap_branch' ? (
                      card.unit_id && card.unit_revision != null ? (
                        <FreestyleUnitReviewCardView
                          card={card}
                          active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
                          readOnly={readOnlyHistoryCardId === card.id}
                          roundId={queueState.roundId}
                          planVersion={planVersion}
                          encounter={queueState.unitEncountersByCardId[card.id]}
                          lastRating={roundPlan?.cardsById[card.id]?.lastRating ?? null}
                          retryAfterCards={RESTUDY_MAX_INTERVENING}
                          fullscreen={freestyleFullscreen && index === currentIndex}
                          onToggleFullscreen={(next) => {
                            setFreestyleFullscreen(next ?? !freestyleFullscreen)
                          }}
                          freestyleFlipMode={flipMode}
                          onFreestyleFlipModeChange={updateFlipMode}
                          autoAdvance={false}
                          preferredZoom={mindmapZoom}
                          onUserZoomChange={updateMindmapZoom}
                          blockedHint={index === currentIndex ? sequentialBlockedHint : null}
                          onRatingSettled={handleRatingSettled}
                          onRoundSync={adoptRoundVersion}
                          onEnsureEncounter={ensureUnitEncounter}
                          onEncounterChange={updateUnitEncounter}
                          onBranchComplete={handleBranchComplete}
                          onStaleDrop={handleStaleDrop}
                          onRebuildRound={reshuffleQueue}
                          onRevisionAdopted={adoptLiveUnitRevision}
                          onSaveFailed={handleCardSaveFailed}
                          onEditingChange={index === currentIndex ? setInlineEditing : undefined}
                          onUnitsReconciled={() => {
                            void buildQueue(config, {
                              preserveCompleted: true,
                              silent: true,
                              preferCardId: card.id,
                            })
                          }}
                          liveRevealMap={index === currentIndex ? liveRevealMap : null}
                          onLiveRevealMapChange={applyLiveRevealMap}
                          onOpenScopeQuiz={() => setScopeQuizOpen(true)}
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
                        active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
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
                      active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
                      state={progress.questionStates[card.question.id]}
                      answeredBefore={answeredQuestionIds.has(card.question.id)}
                      onStateChange={(updater) => updateQuestionState(card.question.id, updater)}
                      onChoiceResolve={(optionId, isCorrect) =>
                        onChoiceResolve(card, optionId, isCorrect)
                      }
                      onShortAnswerSubmit={() => {
                        onShortAnswerSubmit(card)
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
                    completed={liveEncounterFillDone(
                      queueState.unitEncountersByCardId[card.id],
                      queueState.completedIds.includes(card.id),
                    )}
                  />
                </div>
              )
            })
          ) : loading ? (
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
          ) : (
            <FreestyleEmptyState
              mode="free"
              onSwitchMode={() => undefined}
              onReshuffle={() => {
                setConfigIntent('replan')
                setConfigOpen(true)
              }}
              // Empty round: the useful surface is config, not an empty plan list.
              onOpenSettings={() => {
                setConfigIntent('replan')
                setConfigOpen(true)
              }}
              completedCount={queueState.completedIds.length}
              mutedCount={queueState.mutedPalaceIds.length}
              hiddenCount={queueState.hiddenIds.length}
            />
          )}
          {/* Closing slot, appended rather than replacing the feed so 回看 still works. */}
          {(!loading || cards.length > 0) && !error && roundComplete ? (
            <div className="relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always p-0 pt-[calc(env(safe-area-inset-top,0px)+1.25rem)]">
              <FreestyleRoundCompleteCard
                completion={roundCompletion}
                onAnotherRound={() => {
                  setConfigIntent('nextRound')
                  setConfigOpen(true)
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Card paging stays on this pager so the review map can keep one-finger pan. */}
        {!inlineEditing ? (
        <FreestyleFeedPager
          canGoPrevious={
            viewingCompleteSlot
              ? cards.length > 0
              : canGoPrevious && cards.length > 0
          }
          canGoNext={
            freestyleCanPageNext(
              visualIndex,
              cards.length,
              roundComplete,
              Boolean(viewingCardId && pendingRestudyCardIds.includes(viewingCardId)),
            )
          }
          canComplete={canCompleteRound}
          completeTitle={completeTitle}
          onPrevious={navigatePrevious}
          onNext={navigateNext}
          onComplete={handleCompleteRound}
        />
        ) : null}
      </div>
    </TooltipProvider>
  )
}
