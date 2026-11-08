import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { buildFreestyleProgressSummary } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { applyServerRoundProgress } from '@/modules/practice/ui/freestyle/model/freestyleProgressFromServer'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import { preloadMindMapCanvas } from '@/shared/ui/mindmap-canvas'
import {
  hydrateUnitPreviews,
  requestRoundPreview,
  stopRoundPreview,
} from '@/modules/practice/ui/freestyle/model/freestyleUnitPreviewCache'
import {
  buildFreestyleRoundCompletion,
  buildPartialSettlementSnapshot,
  foldPartialSettlementsIntoCompletion,
  isFreestyleRoundComplete,
} from '@/modules/practice/ui/freestyle/model/roundCompletion'
import type { FreestylePartialSettlementSnapshot } from '@/modules/practice/domain/partialSettlement'
import { compressibleRoundPlanIds, createOperationId } from '@/modules/practice/public'
import type { FreestyleConfigSaveChoice } from '@/modules/practice/ui/freestyle/model/overlapProgressChoice'
import { FreestyleHudOverflow } from '@/modules/practice/ui/freestyle/components/FreestyleHudChrome'
import { FreestyleHud } from '@/modules/practice/ui/freestyle/FreestyleHud'
import { FreestyleWaitingBanner } from '@/modules/practice/ui/freestyle/components/FreestyleWaitingBanner'
import { FreestylePageDialogs } from '@/modules/practice/ui/freestyle/FreestylePageDialogs'
import { FreestyleCardArea } from '@/modules/practice/ui/freestyle/FreestyleCardArea'
import { FreestylePalaceDirectoryPanel } from '@/modules/practice/ui/freestyle/components/FreestylePalaceDirectoryPanel'
import { FreestylePalaceJoinDialog } from '@/modules/practice/ui/freestyle/components/FreestylePalaceJoinDialog'
import type { FreestyleQueuePanelProps } from '@/modules/practice/ui/freestyle/components/FreestyleQueuePanel'
import { useFreestylePalaceDirectoryActions } from '@/modules/practice/ui/freestyle/hooks/useFreestylePalaceDirectoryActions'
import { roundPalaceStatuses } from '@/modules/practice/ui/freestyle/model/freestyle-palace-directory'
import { FreestyleNewUnitsBanner } from '@/modules/practice/ui/freestyle/components/FreestyleNewUnitsBanner'
import { FreestyleBedtimeButton } from '@/modules/practice/ui/freestyle/components/FreestyleBedtimeButton'
import { getFreestyleBedtimeCandidatesApi } from '@/modules/practice/ui/freestyle/api'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import {
  advanceNewUnitsBanner,
  countPendingNewUnits,
  INITIAL_NEW_UNITS_BANNER_TRACKER,
  type NewUnitsBannerTracker,
} from '@/modules/practice/ui/freestyle/model/newUnitsFinished'
import { FreestyleStartOverview } from '@/modules/practice/ui/freestyle/components/FreestyleStartOverview'
import { FreestyleConfigPreviewCard } from '@/modules/practice/ui/freestyle/components/FreestyleConfigPreviewCard'
import { FreestyleDayRecap } from '@/modules/practice/ui/freestyle/components/FreestyleDayRecap'
import type { FreestyleSettlementMeta } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSettlement'
import { useFreestyleOverview } from '@/modules/practice/ui/freestyle/hooks/useFreestyleOverview'
import { useTomorrowDueCount } from '@/modules/practice/ui/freestyle/hooks/useTomorrowDueCount'
import { isDayRecapPending, markDayRecapShown } from '@/modules/practice/ui/freestyle/model/freestyleDayRecap'
import type { FreestyleSaveOutcome } from '@/modules/practice/ui/freestyle/model/freestyleSettlementModel'
import { FreestylePartialSettlement } from '@/modules/practice/ui/freestyle/FreestylePartialSettlement'
import { FreestyleBottomActions } from '@/modules/practice/ui/freestyle/FreestyleBottomActions'
import { FreestyleEdgeHint } from '@/modules/practice/ui/freestyle/FreestyleEdgeHint'
import { palaceReviewReturnPath } from '@/modules/practice/ui/freestyle/freestylePageHelpers'
import { cue } from '@/shared/fx'
import { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import { useFreestyleQuizFlow } from '@/modules/practice/ui/freestyle/hooks/useFreestyleQuizFlow'
import { useFreestyleFeedNavigation } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFeedNavigation'
import { useFreestyleLiveSync } from '@/modules/practice/ui/freestyle/hooks/useFreestyleLiveSync'
import { usePalaceClearanceWatch } from '@/modules/practice/ui/freestyle/hooks/usePalaceClearanceWatch'
import { useFreestyleFullscreen } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFullscreen'
import { useFreestyleDisplayPrefs } from '@/modules/practice/ui/freestyle/hooks/useFreestyleDisplayPrefs'
import { useFreestyleSubjectMap } from '@/modules/practice/ui/freestyle/hooks/useFreestyleSubjectMap'
import { usePalaceFavoriteIds } from '@/modules/content/public'
import { useFreestyleRatingOutbox } from '@/modules/practice/ui/freestyle/hooks/useFreestyleRatingOutbox'
import {
  resolveFreestyleAutoAdvanceTarget,
  useFreestyleAutoAdvance,
} from '@/modules/practice/ui/freestyle/hooks/useFreestyleAutoAdvance'
import { useRatingSaveEntries } from '@/modules/practice/ui/freestyle/hooks/useFreestyleRatingSaves'
import { unsavedRatingCardIds } from '@/modules/practice/ui/freestyle/model/ratingSaveStore'
import { resetFreestyleCombo } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { parseFreestyleEntryPalaceId, parseFreestyleEntryPalaceIds } from '@/modules/practice/ui/freestyle/model/freestyle-entry-scope'
import {
  isMindMapBranchCard,
  isQuizCard,
} from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { useFreestyleChromeTheme } from '@/modules/practice/ui/freestyle/hooks/useFreestyleChromeTheme'
import { useFreestyleWakeLock } from '@/modules/practice/ui/freestyle/hooks/useFreestyleWakeLock'
import { useAiRunConfigDialog, useFlipCardRevealSettings } from '@/modules/settings/public'
import {
  cardPalaceId,
  FREESTYLE_WORKSPACE_PRIMARY,
  isPalaceReviewWorkspace,
  palaceReviewWorkspaceId,
  parsePalaceReviewWorkspaceId,
  type FreestyleWorkspaceId,
  type PalaceReviewWorkspaceId,
  type UnitRating,
  freestyleWorkspacePath,
  normalizeFreestyleWorkspaceId,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig, FreestyleQuizCard, FreestyleRoundSummary } from '@/shared/api/contracts'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { toast } from '@/shared/feedback/toast'
import { removeReviewUnitPermanentlyApi } from '@/modules/practice/ui/review/api'
import {
  palaceEditorVisitGeneration,
  waitForPalaceEditorLeave,
} from '@/shared/events/palaceEditorLeaveGate'
import { cn } from '@/shared/lib/utils'
import { isStoredBoolean, useLocalStorageState } from '@/shared/lib/localStorage'
import { useExamOverview } from '@/modules/exam/public'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

const FREESTYLE_STALE_TOAST_ID = 'freestyle-stale-card'
const FREESTYLE_DIRECTORY_COLLAPSED_STORAGE_KEY = 'memory_anki.freestyle_directory_collapsed'

function isNarrowViewport() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(max-width: 767px)').matches)
}

const startOverviewDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

export default function ImmersiveFreestylePage({
  workspace = FREESTYLE_WORKSPACE_PRIMARY,
  lockedPalaceId = null,
}: {
  workspace?: FreestyleWorkspaceId | PalaceReviewWorkspaceId
  /** Shelf review locks this page to one palace and must not enter /freestyle. */
  lockedPalaceId?: number | null
} = {}) {
  const palaceLocked = typeof lockedPalaceId === 'number' && lockedPalaceId > 0
  const slot = palaceLocked
    ? palaceReviewWorkspaceId(lockedPalaceId)
    : isPalaceReviewWorkspace(workspace)
      ? workspace
      : normalizeFreestyleWorkspaceId(workspace)
  const reviewPalaceId = palaceLocked ? lockedPalaceId : parsePalaceReviewWorkspaceId(slot)
  const workspacePath = reviewPalaceId != null
    ? `/palaces/${reviewPalaceId}/review`
    : freestyleWorkspacePath(normalizeFreestyleWorkspaceId(slot))
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const search = searchParams.toString()
  const entryPalaceIds = parseFreestyleEntryPalaceIds(search)
  const entryPalaceId = reviewPalaceId ?? (
    entryPalaceIds.length > 0 ? entryPalaceIds : parseFreestyleEntryPalaceId(search)
  )
  const reviewReturnSubjectId = searchParams.get('subjectId')
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  useFreestyleWakeLock(isActive)
  useFreestyleChromeTheme(isActive)
  const reducedMotion = usePrefersReducedMotion()
  const queueRef = useRef<FreestyleCard[]>([])
  const startOverlayRef = useRef<HTMLDivElement>(null)
  const startFocusReturnRef = useRef<HTMLElement | null>(null)
  const flipCardRevealSettings = useFlipCardRevealSettings()
  const [partialSettlement, setPartialSettlement] = useState<FreestylePartialSettlementSnapshot | null>(null)
  const [startOverviewOpen, setStartOverviewOpen] = useState(true)

  useEffect(() => {
    if (!isActive || !startOverviewOpen || partialSettlement) return
    const root = startOverlayRef.current
    if (!root) return
    const activeElement = document.activeElement
    startFocusReturnRef.current = activeElement instanceof HTMLElement
      && activeElement !== document.body
      && activeElement !== document.documentElement
      ? activeElement
      : document.querySelector<HTMLElement>('[data-testid="freestyle-feed-scroller"]')
    const focusables = () => Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null)
    const anotherModalOwnsFocus = () => Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
    ).some((dialog) => dialog !== root && dialog.offsetParent !== null)
    const focusStart = () => {
      if (!isActive || !startOverviewOpen || !root.isConnected || anotherModalOwnsFocus()) return
      const startButton = root.querySelector<HTMLElement>('[data-testid="freestyle-start-button"]')
      ;(startButton ?? focusables()[0])?.focus()
    }
    const frame = window.requestAnimationFrame(focusStart)
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isActive || !startOverviewOpen || anotherModalOwnsFocus() || event.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    root.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [isActive, partialSettlement, startOverviewOpen])

  useEffect(() => {
    if (startOverviewOpen || !isActive) return
    const returnTarget = startFocusReturnRef.current
    if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true })
    startFocusReturnRef.current = null
  }, [isActive, startOverviewOpen])

  const [dayRecapOpen, setDayRecapOpen] = useState(() => isDayRecapPending(window.localStorage, new Date()))
  const [configOpen, setConfigOpen] = useState(false)
  /** Settlement 「再来一轮」 opens config in nextRound mode; HUD uses replan. */
  const [configIntent, setConfigIntent] = useState<'replan' | 'nextRound'>('replan')
  const [scopeQuizOpen, setScopeQuizOpen] = useState(false)
  const [newUnitsBannerTracker, setNewUnitsBannerTracker] = useState<NewUnitsBannerTracker>(INITIAL_NEW_UNITS_BANNER_TRACKER)
  const [newUnitsBannerVisible, setNewUnitsBannerVisible] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { promptForAiOptions } = useAiRunConfigDialog()
  const [inlineEditing, setInlineEditing] = useState(false)
  const [bedtimeOpen, setBedtimeOpen] = useState(false)
  const [bedtimeCount, setBedtimeCount] = useState<number | null>(null)
  const [bedtimeBusy, setBedtimeBusy] = useState(false)
  const { flipMode, mindmapZoom, updateFlipMode, updateMindmapZoom } = useFreestyleDisplayPrefs()
  const { freestyleFullscreen, toggleFreestyleFullscreen } = useFreestyleFullscreen()
  // Its own switch, not the app nav's: collapsing the sidebar must not take the
  // directory with it, and closing the directory must not hide the nav.
  const [directoryCollapsed, setDirectoryCollapsed] = useLocalStorageState(
    FREESTYLE_DIRECTORY_COLLAPSED_STORAGE_KEY,
    isNarrowViewport(),
    isStoredBoolean,
  )
  const subjectByPalaceId = useFreestyleSubjectMap()
  const favoritePalaceIds = usePalaceFavoriteIds()

  const {
    config,
    setConfigAndPersist,
    queueState,
    roundMeta,
    roundPlan,
    waiting,
    cards,
    setCards,
    currentIndex,
    goToIndex,
    flushDeferredRestudy,
    loading,
    error,
    refreshQueue,
    updateReviewQueue,
    syncDesktopProgress,
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
    compressCompletedPlanCards,
    reopenPalaceCards,
    pendingRestudyCardIds,
    planVersion,
    wrongUnitIds,
    roundProgress,
    adoptRoundVersion,
    appendBedtimeReview,
    rateBedtimeCard,
    hydrateLiveRound,
    clearConfiguredOverlayQuiz,
    queueFrozen,
    startupVisualIndex,
    clearStartupVisualIndex,
    roundSave,
    roundSummary,
    retryRoundSave,
  } = useImmersiveQueue(entryPalaceId, slot)
  const freestyleOverview = useFreestyleOverview(queueState.roundId)
  const [previewSummary, setPreviewSummary] = useState<FreestyleRoundSummary | null>(null)
  const configPreviewPendingRef = useRef(false)
  useEffect(() => {
    if (!roundSummary || !configPreviewPendingRef.current) return
    configPreviewPendingRef.current = false
    setPreviewSummary(roundSummary.summary)
  }, [roundSummary])

  const saveFreestyleConfig = useCallback((
    nextConfig: FreestyleFeedConfig,
    choice: FreestyleConfigSaveChoice = 'keep-overlap',
  ) => {
    resetStaleRecovery()
    if (configIntent === 'nextRound' || choice === 'start-fresh') {
      configPreviewPendingRef.current = true
      startNextRound(nextConfig)
      setConfigIntent('replan')
    } else {
      configPreviewPendingRef.current = true
      setConfigAndPersist(nextConfig)
    }
    // A query-param launch hint is not the shelf's palace review. Remove it after
    // saving so refresh cannot reapply that hint over a saved 随心 selection.
    // Palace review keeps its own route and must never be rewritten to /freestyle.
    if (reviewPalaceId == null && entryPalaceId != null) navigate(workspacePath, { replace: true })
  }, [
    configIntent,
    entryPalaceId,
    navigate,
    reviewPalaceId,
    resetStaleRecovery,
    setConfigAndPersist,
    startNextRound,
    workspacePath,
  ])

  queueRef.current = cards
  const openBedtimeDialog = useCallback(async () => {
    const roundId = queueState.roundId
    if (!roundId) return
    setBedtimeOpen(true)
    setBedtimeCount(null)
    setBedtimeBusy(true)
    try {
      const result = await getFreestyleBedtimeCandidatesApi(roundId)
      setBedtimeCount(result.count)
    } catch {
      setBedtimeOpen(false)
      toast.error('读不到今天的已评分卡片，请稍后再试。')
    } finally {
      setBedtimeBusy(false)
    }
  }, [queueState.roundId])
  const confirmBedtimeReview = useCallback(async () => {
    setBedtimeBusy(true)
    try {
      const added = await appendBedtimeReview()
      setBedtimeOpen(false)
      if (added.length) toast.success(`已加入 ${added.length} 座宫殿的睡前复习`)
    } catch {
      toast.error('加入睡前复习失败，请稍后再试。')
    } finally {
      setBedtimeBusy(false)
    }
  }, [appendBedtimeReview])
  const bedtimeDescription = bedtimeCount == null
    ? '正在读今天的学习记录…'
    : bedtimeCount === 0
      ? '今天还没有新的已评分宫殿。先学一会儿，再回来点月亮。'
      : `${bedtimeCount} 座今天学过的宫殿会追加到当前队列末尾（整座宫殿算一次复习）。睡前复习的评分只用来过一遍，不会改动原来的复习安排。`
  const { signalPageTurn } = useFreestyleFlowFeedback()
  const signalPageTurnWithDust = useCallback((direction: 'forward' | 'backward') => {
    signalPageTurn(direction)
    cue('page.turn', {})
  }, [signalPageTurn])
  const currentCard = cards[currentIndex] ?? null
  const currentPalaceId = cardPalaceId(currentCard)
  /**
   * Everything the feed presents has a this-round score. That is not yet 本轮
   * 完成 when the server still owes same-day 重练 (`waiting`): those cards are
   * unfinished learning, merely not due. The closing slot stays reachable (完成
   * must never dead-end) but renders a waiting page instead of the trophy, and
   * the round only celebrates once `waiting` is empty.
   */
  const pendingReviewCount = waiting?.count ?? 0
  const roundComplete = isFreestyleRoundComplete(
    cards,
    queueState.unitEncountersByCardId,
    queueState.completedIds,
    roundPlan,
    queueState.hiddenIds,
  )
  const {
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
    unscoredIndices,
    scrollChannel,
    edgeHint,
  } = useFreestyleFeedNavigation({
    cards,
    currentIndex,
    roundComplete,
    pendingReviewCount,
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
    onStartupVisualApplied: clearStartupVisualIndex,
    onPageTurn: isActive ? signalPageTurnWithDust : undefined,
  })
  /**
   * 翻卡设置 → 评分后自动翻页: after a rating settles on the card under the viewport,
   * jump to the earliest unit still unscored this round (not merely the neighbour).
   * Off by default; manual paging stays the rule.
   */
  const autoAdvanceTargetRef = useRef({ unscoredIndices, cardCount: cards.length, roundComplete })
  autoAdvanceTargetRef.current = { unscoredIndices, cardCount: cards.length, roundComplete }
  const resolveAutoAdvanceTarget = useCallback(
    () => resolveFreestyleAutoAdvanceTarget(autoAdvanceTargetRef.current),
    [],
  )
  const { scheduleAutoAdvance, cancelAutoAdvance } = useFreestyleAutoAdvance({
    // Leaving the route must not let a pending turn move the queue underneath the learner.
    enabled: isActive && flipCardRevealSettings.settings.autoAdvanceOnRate === true,
    viewingCardId,
    resolveTargetIndex: resolveAutoAdvanceTarget,
    navigateToIndex,
  })
  const { palaceClearance, setPalaceClearance } = usePalaceClearanceWatch({
    cards,
    currentIndex,
    queueState,
    roundMeta,
    roundPlan,
    pendingRestudyCardIds,
    loading,
    error,
  })

  const settlementVisible = viewingCompleteSlot || partialSettlement != null
  const settlementSaveOutcome: FreestyleSaveOutcome = roundSave?.roundId === queueState.roundId
    ? roundSave.outcome
    : 'unconfirmed'
  const dueTomorrowCount = useTomorrowDueCount(roundComplete)
  const settlementMeta: FreestyleSettlementMeta = {
    saveOutcome: settlementSaveOutcome,
    onRetrySave: () => { void retryRoundSave() },
    remainingBefore: freestyleOverview.baseline?.round?.counts.remaining_units ?? null,
    remainingAfter: freestyleOverview.overview?.round?.counts.remaining_units ?? null,
    remainingPalaces: freestyleOverview.overview?.round?.counts.remaining_palaces ?? null,
    remainingUnits: freestyleOverview.overview?.round?.counts.remaining_units ?? null,
    nextReviews: freestyleOverview.overview?.next_reviews ?? [],
  }

  useEffect(() => {
    setInlineEditing(false)
  }, [currentIndex])

  useEffect(() => {
    void hydrateUnitPreviews()
  }, [])

  // Preload follows the card the feed is moving toward. Fast flips retarget the
  // same pump instead of aborting a fetch that is about to become useful.
  const previewIndexRef = useRef<number | null>(null)
  const previewDirectionRef = useRef<-1 | 0 | 1>(0)
  useEffect(() => {
    if (!isActive || loading || cards.length === 0) {
      stopRoundPreview()
      return
    }
    const previous = previewIndexRef.current
    const direction: -1 | 0 | 1 = previous == null || visualIndex === previous
      ? previewDirectionRef.current
      : visualIndex > previous ? 1 : -1
    previewIndexRef.current = visualIndex
    if (previous != null && visualIndex !== previous) previewDirectionRef.current = direction
    requestRoundPreview(cards, visualIndex, previous == null ? 0 : direction)
  }, [cards, isActive, loading, visualIndex])

  // Every unit card mounts a map; fetch the canvas chunk before the first one needs it.
  useEffect(() => {
    const idle = window.requestIdleCallback?.(() => preloadMindMapCanvas(), { timeout: 1_500 })
    const fallback = idle == null ? window.setTimeout(preloadMindMapCanvas, 300) : null
    return () => {
      if (idle != null) window.cancelIdleCallback?.(idle)
      if (fallback != null) window.clearTimeout(fallback)
    }
  }, [])

  const updateFeedQuestion = useCallback(
    (question: FreestyleQuizCard['question']) => {
      setCards((current) =>
        current.map((card) =>
          isQuizCard(card) && card.question.id === question.id
            ? { ...card, question }
            : card,
        ),
      )
    },
    [setCards],
  )
  const {
    progress,
    updateQuestionState,
  } = useFreestyleQuizFlow({
    mode: 'free',
    queueRef,
    reducedMotion,
    promptForAiOptions,
    // Avoid restoring prior choice states that disable options on reappearance.
    freshAttemptStates: true,
    updateFeedQuestion,
  })

  useFreestyleLiveSync({
    fullPath,
    // Live mirror is keyed by one palace. Multi-palace entry stays local.
    entryPalaceId: typeof entryPalaceId === 'number' ? entryPalaceId : null,
    isActive,
    cards,
    currentIndex,
    currentCard,
    roundComplete,
    visualIndex,
    viewingCompleteSlot,
    planVersion,
    queueState,
    navigateToIndex,
    progress,
    updateQuestionState,
    adoptRoundVersion,
    updateUnitEncounter,
    completeCardBatch,
    hydrateLiveRound,
  })

  useEffect(() => {
    resetFreestyleCombo()
  }, [])

  const handleBranchComplete = useCallback(
    (
      cardId: string,
      options?: {
        restudy?: boolean
        cleared?: boolean
        rating?: number
        retryAfterCards?: number
        retryAvailableAt?: string | null
        retryExhausted?: boolean
      },
    ) => {
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

  /**
   * A settled rating from the visible card may hand a page turn to the
   * auto-advance timer. Background queue ratings must never move the viewport.
   */
  const handleRatingSettled = useCallback(
    (
      cardId: string,
      passed: boolean,
      _rating: UnitRating,
      _meta?: { occurrenceId?: string; encounterId?: string; planVersion?: number },
    ) => {
      if (cardId !== viewingCardId) return
      // 忘记 keeps the learner on the source card: its retry is booked later,
      // so there is no next card to turn to.
      if (passed) scheduleAutoAdvance(cardId)
      else cancelAutoAdvance()
    },
    [cancelAutoAdvance, scheduleAutoAdvance, viewingCardId],
  )

  const handleStaleDrop = useCallback(
    (cardId: string, options?: { force?: boolean }) => {
      // Do not mark completed — still-due units must stay eligible (vs Insights queue).
      // A deleted palace is not a sync burst: force past the hold circuit.
      const result = dropStaleCard(cardId, options?.force ? { force: true } : undefined)
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

  const saveFailureViewRef = useRef({ cards, currentIndex, goToIndex })
  saveFailureViewRef.current = { cards, currentIndex, goToIndex }
  const handleCardSaveFailed = useCallback((message: string, cardId: string) => {
    const view = saveFailureViewRef.current
    const index = view.cards.findIndex((card) => card.id === cardId)
    if (index < 0 || index === view.currentIndex) {
      setSaveError(message)
      toast.error(message)
      return
    }
    // The learner already moved on: tell them which unit failed and let them
    // jump back; never navigate for them.
    toast.error(`第 ${index + 1} 个单元没有保存成功`, {
      id: `freestyle-rating-failed:${cardId}`,
      action: {
        label: '回到这张',
        onClick: () => {
          saveFailureViewRef.current.goToIndex(index, { reorderRestudy: false })
        },
      },
    })
  }, [])

  const excludedPlanIds = useMemo(() => new Set(
    Object.values(roundPlan?.cardsById ?? {})
      .filter((entry) => entry.status === 'excluded')
      .map((entry) => entry.cardId),
  ), [roundPlan])
  // Card and queue-panel ratings share this ledger, including acknowledgements
  // for cards that are not mounted. Queue ratings never advance the visible card.
  const {
    rateCards: rateQueueCards,
    failedCount: unsavedRatingCount,
    retryUnsaved: retryUnsavedRatings,
  } = useFreestyleRatingOutbox({
    roundId: queueState.roundId,
    cards,
    encounters: queueState.unitEncountersByCardId,
    excludedIds: excludedPlanIds,
    planVersion,
    viewingCardId,
    ensureUnitEncounter,
    adoptRound: adoptRoundVersion,
    encounterChange: updateUnitEncounter,
    branchComplete: handleBranchComplete,
    ratingSettled: handleRatingSettled,
    cardSaveFailed: handleCardSaveFailed,
    staleDrop: handleStaleDrop,
  })

  // A grade the outbox has not acknowledged is not a score yet: the rail must
  // not fill for it, even if a plan echo elsewhere already spells it out.
  const ratingSaveEntries = useRatingSaveEntries(queueState.roundId)
  const unsavedRatingIds = useMemo(
    () => unsavedRatingCardIds(ratingSaveEntries),
    [ratingSaveEntries],
  )
  const localProgressSummary = useMemo(
    () => buildFreestyleProgressSummary(
      cards,
      roundPlan,
      queueState.completedIds,
      queueState.hiddenIds,
      viewingCardId,
      queueState.unitEncountersByCardId,
      unsavedRatingIds,
      wrongUnitIds,
    ),
    [
      cards,
      queueState.completedIds,
      queueState.hiddenIds,
      queueState.unitEncountersByCardId,
      roundPlan,
      unsavedRatingIds,
      viewingCardId,
      wrongUnitIds,
    ],
  )

  // The server owns the numbers and the wrong/waiting flags; the local summary
  // only supplies the immediate tick fill until the next response lands.
  const progressSummary = useMemo(
    () => applyServerRoundProgress(
      localProgressSummary,
      roundProgress?.roundId === queueState.roundId ? roundProgress.progress : null,
    ),
    [localProgressSummary, queueState.roundId, roundProgress],
  )

  /**
   * Palaces that still own a tick on the progress rail, each with how far it has
   * got: 还没评分 / 有待重练 / 已评分完. The directory dots read the same segments the
   * rail draws, so the round's reach and its remaining work stay one story.
   */
  const queuedPalaces = useMemo(
    () => roundPalaceStatuses(progressSummary.segments),
    [progressSummary],
  )

  const { data: examOverview } = useExamOverview()

  const roundCompletion = useMemo(
    () => foldPartialSettlementsIntoCompletion(
      buildFreestyleRoundCompletion(
      cards,
      queueState.unitEncountersByCardId,
      roundMeta.candidate_count,
      {
        completedIds: queueState.completedIds,
        scheduledCount: roundMeta.scheduled_count || roundPlan?.scheduledCount,
        roundPlan,
        subjectByPalaceId,
      },
    ),
      roundPlan?.partialSettlements,
      cards.map((card) => card.id),
    ),
    [
      cards,
      queueState.completedIds,
      queueState.unitEncountersByCardId,
      roundMeta.candidate_count,
      roundMeta.scheduled_count,
      roundPlan,
      subjectByPalaceId,
    ],
  )

  const mindmapCount = cards.filter(isMindMapBranchCard).length

  const overflowSummary = cards.length === 0
    ? `本轮 0 张 · 候选 ${roundMeta.candidate_count}`
    : `导图 ${mindmapCount} · 候选 ${roundMeta.candidate_count}`
  /** HUD and rail header open 随心配置 directly; the plan list no longer exists. */
  const openPlan = useCallback(() => {
    setConfigIntent('replan')
    setConfigOpen(true)
  }, [])
  const jumpFromProgressRail = useCallback((cardId: string) => {
    const index = cards.findIndex((card) => card.id === cardId)
    if (index < 0) {
      setConfigIntent('replan')
      setConfigOpen(true)
      return
    }
    const direction: -1 | 0 | 1 = index > currentIndex ? 1 : index < currentIndex ? -1 : 0
    requestRoundPreview(cards, index, direction)
    navigateToIndex(index)
  }, [cards, currentIndex, navigateToIndex])
  const {
    palaceJoin,
    palaceJoinBusy,
    openPalaceFromDirectory,
    confirmPalaceJoin,
    cancelPalaceJoin,
    editPalace,
  } = useFreestylePalaceDirectoryActions({
    currentPalaceId,
    reviewPalaceId,
    cards,
    completedIds: queueState.completedIds,
    encounters: queueState.unitEncountersByCardId,
    roundPlan,
    roundId: queueState.roundId || null,
    currentCardId: currentCard?.id ?? null,
    jumpFromProgressRail,
    setConfigAndPersist,
    reopenPalaceCards,
  })
  const openHistory = useCallback(() => setHistoryOpen(true), [])
  const location = useLocation()
  const seenEditorVisitRef = useRef(0)
  const inlineEditingRef = useRef(inlineEditing)
  inlineEditingRef.current = inlineEditing
  const updateReviewQueueRef = useRef(updateReviewQueue)
  updateReviewQueueRef.current = updateReviewQueue
  const announceQueueUpdate = useCallback((message: string) => {
    const notify = message === '已经是最新的' ? toast.info : toast.success
    notify(message, { id: 'freestyle-queue-update' })
  }, [])
  const runQueueUpdate = useCallback(() => {
    if (inlineEditingRef.current) {
      toast.info('先退出这张的编辑，再更新队列', { id: 'freestyle-queue-update' })
      return
    }
    void updateReviewQueue().then((result) => {
      if (result.status === 'busy') return
      if (result.status === 'error') {
        toast.error('没能更新队列，请再试一次', { id: 'freestyle-queue-update' })
        return
      }
      announceQueueUpdate(result.message)
    }).catch(() => {
      toast.error('没能更新队列，请再试一次', { id: 'freestyle-queue-update' })
    })
  }, [announceQueueUpdate, updateReviewQueue])
  useEffect(() => {
    if (!isActive) return
    const onThisWorkspace = location.pathname === workspacePath
      || location.pathname.startsWith(`${workspacePath}/`)
    if (!onThisWorkspace) return
    const editorVisit = palaceEditorVisitGeneration()
    if (editorVisit <= seenEditorVisitRef.current) return
    if (inlineEditingRef.current) return
    seenEditorVisitRef.current = editorVisit
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        await waitForPalaceEditorLeave()
        if (cancelled || inlineEditingRef.current) return
        const result = await updateReviewQueueRef.current()
        if (cancelled || result.status !== 'ok') return
        announceQueueUpdate(result.message)
      })()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [announceQueueUpdate, isActive, location.pathname, workspacePath])
  const syncComputerProgress = useCallback(() => {
    void syncDesktopProgress().then((result) => {
      if (result.status === 'busy' || result.status === 'stale') return
      if (result.status === 'empty') {
        toast.info('电脑还没有这一轮进度')
        return
      }
      toast.success(
        result.remaining > 0
          ? `已同步电脑进度，还有 ${result.remaining} 张未评分`
          : '已同步电脑进度，这一轮已经评完',
      )
    }).catch(() => {
      toast.error('同步失败，请确认手机连的是这台电脑')
    })
  }, [syncDesktopProgress])
  const openScopeQuiz = useCallback(() => setScopeQuizOpen(true), [])
  const removeCardFromQueue = useCallback(
    (cardId: string) => excludePlanCards([cardId]),
    [excludePlanCards],
  )
  const queuePanelProps = useMemo<FreestyleQueuePanelProps>(() => ({
    cards,
    roundPlan,
    completedIds: queueState.completedIds,
    hiddenIds: queueState.hiddenIds,
    encounters: queueState.unitEncountersByCardId,
    currentCardId: currentCard?.id ?? null,
    ratingSaveEntries,
    onExclude: excludePlanCards,
    onRestore: restorePlanCards,
    onReorder: reorderPlan,
    onRateCards: rateQueueCards,
  }), [
    cards,
    currentCard?.id,
    excludePlanCards,
    queueState.completedIds,
    queueState.hiddenIds,
    queueState.unitEncountersByCardId,
    rateQueueCards,
    ratingSaveEntries,
    reorderPlan,
    restorePlanCards,
    roundPlan,
  ])
  const removeCardPermanently = useCallback(async (cardId: string, unitId: string) => {
    try {
      await removeReviewUnitPermanentlyApi(unitId)
    } catch {
      toast.error('没能永久移除，请再试一次')
      return
    }
    excludePlanCards([cardId])
    toast.success('已永久移除，以后不再安排复习')
  }, [excludePlanCards])

  // Stable overflow tree: recreating DropdownMenuTrigger every parent render
  // under TooltipProvider loops Radix composeRefs (Vite Maximum update depth).
  const progressRailOverflow = useMemo(() => (
    <FreestyleHudOverflow
      summaryLabel={overflowSummary}
      onOpenPlan={openPlan}
      onUpdateQueue={runQueueUpdate}
      onSyncProgress={syncComputerProgress}
      onOpenHistory={openHistory}
      returnTo={reviewPalaceId != null ? palaceReviewReturnPath(reviewReturnSubjectId) : null}
    />
  ), [openHistory, openPlan, overflowSummary, reviewPalaceId, reviewReturnSubjectId, runQueueUpdate, syncComputerProgress])

  const reconcileUnitsFor = useCallback(async (_cardId: string) => {
    const result = await updateReviewQueue()
    if (result.status !== 'ok') throw new Error('复习安排更新失败，请重试')
  }, [updateReviewQueue])
  // One snapshot builder serves both entry points: 结算已完成单元 previews it on
  // the 小结算 page, and 完成 on a genuinely finished round settles it straight
  // away (see handlePagerComplete).
  const reloadOverview = freestyleOverview.reload
  const buildCompletedSettlement = useCallback(() => {
    const ids = compressibleRoundPlanIds(roundPlan, {
      completedIds: queueState.completedIds,
      encounters: queueState.unitEncountersByCardId,
      liveCardIds: cards.map((card) => card.id),
    })
    if (!ids.length) return null
    return buildPartialSettlementSnapshot({
      id: createOperationId(),
      cardIds: ids,
      cards,
      encountersByCardId: queueState.unitEncountersByCardId,
      completedIds: queueState.completedIds,
      roundPlan,
      subjectByPalaceId,
    })
  }, [cards, queueState.completedIds, queueState.unitEncountersByCardId, roundPlan, subjectByPalaceId])
  /** Config page 结算已完成: show the summary dialog, then compress on confirm. */
  const openSettlementFromConfig = useCallback(() => {
    const snapshot = buildCompletedSettlement()
    setConfigOpen(false)
    if (snapshot) setPartialSettlement(snapshot)
  }, [buildCompletedSettlement])
  /**
   * Settle what this round already rated. Same ledger write as 结算已完成单元
   * (`compress_completed`) minus the confirmation page, so the progress rail,
   * 随心列表 and the swipe feed all lose those units.
   */
  const settleCompletedUnits = useCallback(() => {
    const snapshot = buildCompletedSettlement()
    if (!snapshot) return false
    setPartialSettlement(null)
    compressCompletedPlanCards(snapshot)
    void reloadOverview()
    return true
  }, [buildCompletedSettlement, compressCompletedPlanCards, reloadOverview])
  /**
   * Right-side 完成. While the round is open it keeps the seek behaviour; once
   * every presented unit is scored it is a real completion, so it settles the
   * rated units and leaves only the closing slot (nothing to page back to).
   * Same-day 重练 still owed keeps the slot as a waiting page: nothing is
   * compressed, because those groups are still owed today.
   */
  const handlePagerComplete = useCallback(() => {
    if (roundComplete && pendingReviewCount === 0) {
      if (settleCompletedUnits()) return
    }
    handleCompleteRound()
  }, [handleCompleteRound, pendingReviewCount, roundComplete, settleCompletedUnits])
  /**
   * 「今天到此为止」on the waiting page / 结算 on the closing page: end this round
   * and open the next one. Nothing here waits on a compress or a quiz choice, so
   * a round can always be closed instead of dead-ending. When the new round has
   * nothing to show, the page lands on 今天的学习.
   */
  const pendingNextRoundRef = useRef(false)
  const settleAndGoOn = useCallback(() => {
    // Starting the next round is the settlement: `/rounds/start` completes the
    // active round and mints a fresh one, so the old queue stops existing.
    // Compressing the old plan here would only race that build.
    setPartialSettlement(null)
    pendingNextRoundRef.current = true
    startNextRound(config)
    void reloadOverview()
  }, [config, reloadOverview, startNextRound])
  useEffect(() => {
    if (!pendingNextRoundRef.current || loading) return
    if (cards.length > 0) {
      pendingNextRoundRef.current = false
      return
    }
    // Nothing left today: land on 今天的学习 instead of an empty stage.
    pendingNextRoundRef.current = false
    setStartOverviewOpen(true)
  }, [cards.length, loading])
  const handleConfigOpenChange = useCallback((open: boolean) => {
    setConfigOpen(open)
    if (!open) setConfigIntent('replan')
  }, [])
  const dismissPartialSettlement = useCallback(() => setPartialSettlement(null), [])
  const confirmPartialSettlement = useCallback((snapshot: FreestylePartialSettlementSnapshot) => {
    setPartialSettlement(null)
    compressCompletedPlanCards(snapshot)
  }, [compressCompletedPlanCards])
  const dismissSaveError = useCallback(() => setSaveError(''), [])
  const dismissPalaceClearance = useCallback(() => setPalaceClearance(null), [setPalaceClearance])
  const dismissNewUnitsBanner = useCallback(() => setNewUnitsBannerVisible(false), [])

  const pendingNewUnits = countPendingNewUnits(
    cards,
    queueState.unitEncountersByCardId,
    queueState.completedIds,
    roundPlan,
  )
  const roundIdForBanner = queueState.roundId
  useEffect(() => {
    if (!roundIdForBanner) return
    const next = advanceNewUnitsBanner(newUnitsBannerTracker, roundIdForBanner, pendingNewUnits)
    if (next.tracker !== newUnitsBannerTracker) setNewUnitsBannerTracker(next.tracker)
    if (next.show) setNewUnitsBannerVisible(true)
  }, [newUnitsBannerTracker, pendingNewUnits, roundIdForBanner])

  return (
    <TooltipProvider>
      <FreestylePalaceDirectoryPanel
        currentPalaceId={currentPalaceId}
        queuedPalaces={queuedPalaces}
        collapsed={directoryCollapsed}
        onCollapsedChange={setDirectoryCollapsed}
        onSelectPalace={openPalaceFromDirectory}
        onEditPalace={editPalace}
        queuePanel={queuePanelProps}
        hidden={freestyleFullscreen}
      >
      <div
        className={cn(
          // Warm charcoal field; the only glow sits low behind the rating dock.
          'freestyle-stage relative max-w-full overflow-hidden text-stage-ink',
          // Shell already fills the viewport on mind-map hosts; keep the feed flush.
          'flex h-full min-h-0 flex-1 flex-col rounded-none border-0',
          freestyleFullscreen && 'fixed inset-0 z-[80] h-[100dvh] max-w-none rounded-none border-0 shadow-none',
        )}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <FreestylePageDialogs
          queueState={queueState}
          roundPlan={roundPlan}
          settlementCount={compressibleRoundPlanIds(roundPlan, {
            completedIds: queueState.completedIds,
            encounters: queueState.unitEncountersByCardId,
            liveCardIds: cards.map((card) => card.id),
          }).length}
          onSettleCompleted={openSettlementFromConfig}
          configOpen={configOpen}
          onConfigOpenChange={handleConfigOpenChange}
          config={config}
          configIntent={configIntent}
          onSaveConfig={saveFreestyleConfig}
          reviewPalaceId={reviewPalaceId}
          scopeQuizOpen={scopeQuizOpen}
          onScopeQuizOpenChange={setScopeQuizOpen}
          planVersion={planVersion}
          wrongUnitIds={wrongUnitIds}
          slot={slot}
          onSetConfigAndPersist={setConfigAndPersist}
          onRoundSync={adoptRoundVersion}
          historyOpen={historyOpen}
          onHistoryOpenChange={setHistoryOpen}
          currentCard={currentCard}
        />

        <FreestyleHud
          examOverview={examOverview}
          milestones={freestyleOverview.overview?.milestones ?? null}
          palaceTitle={(currentCard as { palace_title?: string } | null)?.palace_title ?? ''}
          palaceFavorite={currentPalaceId != null && favoritePalaceIds.has(currentPalaceId)}
          favoritePalaceIds={favoritePalaceIds}
          progressSummary={progressSummary}
          scrollChannel={scrollChannel}
          progressRailOverflow={progressRailOverflow}
          onOpenPlan={openPlan}
          onJump={jumpFromProgressRail}
          saveError={saveError}
          onDismissSaveError={dismissSaveError}
          unsavedRatingCount={unsavedRatingCount}
          onRetryUnsavedRatings={retryUnsavedRatings}
          palaceClearance={palaceClearance}
          onDismissPalaceClearance={dismissPalaceClearance}
          settlementVisible={settlementVisible}
          staleCircuitOpen={staleCircuitOpen}
          showStaleRecovery={currentCard?.id === staleRecoveryCardId}
          onSkipStaleRecovery={handleSkipStaleRecovery}
          onRebuildStaleRecovery={handleRebuildStaleRecovery}
          onOpenStaleConfig={handleOpenStaleConfig}
        />

        {/* In-flow strips sit under the header and above the card. The header must
            stay at the very top: it is the only thing that may claim the notch. */}
        {newUnitsBannerVisible ? (
          <FreestyleNewUnitsBanner onDismiss={dismissNewUnitsBanner} />
        ) : null}

        {waiting && waiting.count > 0 ? (
          <FreestyleWaitingBanner
            count={waiting.count}
            readyAt={waiting.next_ready_at}
            onRefresh={refreshQueue}
          />
        ) : null}

        <FreestyleCardArea
          scrollRef={scrollRef}
          onScroll={handleScroll}
          cards={cards}
          currentIndex={currentIndex}
          visualIndex={visualIndex}
          mounted={mounted}
          isActive={isActive}
          settlementVisible={settlementVisible}
          roundComplete={roundComplete}
          waiting={waiting}
          loading={loading}
          error={error}
          config={config}
          onRefreshQueue={refreshQueue}
          onOpenConfig={handleOpenStaleConfig}
          readOnlyHistoryCardId={readOnlyHistoryCardId}
          freestyleFullscreen={freestyleFullscreen}
          flipMode={flipMode}
          mindmapZoom={mindmapZoom}
          queueState={queueState}
          roundPlan={roundPlan}
          planVersion={planVersion}
          wrongUnitIds={wrongUnitIds}
          onToggleFullscreen={toggleFreestyleFullscreen}
          onFlipModeChange={updateFlipMode}
          onMindmapZoomChange={updateMindmapZoom}
          onEnsureEncounter={ensureUnitEncounter}
          onEncounterChange={updateUnitEncounter}
          onStaleDrop={handleStaleDrop}
          onRemoveFromQueue={removeCardFromQueue}
          onRemovePermanently={removeCardPermanently}
          onRebuildRound={reshuffleQueue}
          onRevisionAdopted={adoptLiveUnitRevision}
          onCardSaveFailed={handleCardSaveFailed}
          onCardHandled={acknowledgeCard}
          onEditingChange={setInlineEditing}
          onReconcileUnits={reconcileUnitsFor}
          onOpenScopeQuiz={openScopeQuiz}
          onBedtimeRate={rateBedtimeCard}
          onNavigateToIndex={navigateToIndex}
          roundCompletion={roundCompletion}
          dueTomorrowCount={dueTomorrowCount}
          settlementMeta={settlementMeta}
          onClearQuizProgress={clearConfiguredOverlayQuiz}
          onSettle={settleAndGoOn}
          onCancelSettlement={navigatePrevious}
          canCancelSettlement={cards.length > 0}
        />

        {previewSummary && !partialSettlement ? (
          <div
            data-testid="freestyle-config-preview-overlay"
            data-keyboard-shortcuts-suspended="true"
            className="absolute inset-0 z-[65] flex flex-col justify-center overflow-y-auto overscroll-contain bg-stage/95 px-3 py-6 backdrop-blur-sm"
          >
            <div className="mx-auto w-full max-w-md">
              <FreestyleConfigPreviewCard
                summary={previewSummary}
                unitOrder={config.streams.memory_palace.unit_order}
                newPlacement={config.new_placement}
                palaceTitleByCardId={Object.fromEntries(
                  cards.map((card) => [card.id, (card as { palace_title?: string }).palace_title ?? '']),
                )}
                onStart={() => setPreviewSummary(null)}
              />
            </div>
          </div>
        ) : null}
        {startOverviewOpen && !partialSettlement ? (
          <div
            ref={startOverlayRef}
            data-testid="freestyle-start-overview"
            data-keyboard-shortcuts-suspended="true"
            role="dialog"
            aria-modal="true"
            aria-label="今天的学习"
            onKeyDown={(event) => {
              if (!isActive || event.key !== 'Tab') return
              const root = startOverlayRef.current
              if (!root) return
              const items = Array.from(root.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
              )).filter((element) => element.offsetParent !== null)
              if (!items.length) return
              const first = items[0]
              const last = items[items.length - 1]
              if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
                event.preventDefault()
                first.focus()
              }
            }}
            className="absolute inset-0 z-[60] flex flex-col justify-center overflow-y-auto overscroll-contain bg-stage/95 px-3 py-6 backdrop-blur-sm"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {/* A title anchors the gate: without it the two cards floated
                  mid-screen over an empty stage with nothing saying what this is. */}
              <div className="flex items-baseline justify-between gap-2 px-1 pb-1">
                <h2 className="ma-display text-2xl font-semibold text-ink-stage">今天的学习</h2>
                <span className="ma-figure text-xs tabular-nums text-ink-stage-muted">
                  {startOverviewDateFormatter.format(new Date())}
                </span>
              </div>
              {dayRecapOpen && freestyleOverview.overview ? (
                <FreestyleDayRecap
                  yesterday={freestyleOverview.overview.yesterday}
                  onDismiss={() => {
                    markDayRecapShown(window.localStorage, new Date())
                    setDayRecapOpen(false)
                  }}
                />
              ) : null}
              <FreestyleStartOverview
                overview={freestyleOverview.overview}
                loading={freestyleOverview.loading}
                error={freestyleOverview.error}
                onStart={() => setStartOverviewOpen(false)}
                onRetry={() => { void freestyleOverview.reload() }}
                hideYesterday={dayRecapOpen && Boolean(freestyleOverview.overview)}
              />
            </div>
          </div>
        ) : null}
        {partialSettlement ? (
          <FreestylePartialSettlement
            snapshot={partialSettlement}
            roundId={queueState.roundId}
            onExit={dismissPartialSettlement}
            onConfirmPartial={confirmPartialSettlement}
          />
        ) : null}
        {edgeHint ? (
          <FreestyleEdgeHint edgeHint={edgeHint} roundComplete={roundComplete} />
        ) : null}

        {/* Card paging stays on this pager so the review map can keep one-finger pan.
            The closing page owns its own actions (取消结算 / 结算), so the pager
            steps aside there instead of floating over the summary. */}
        {!inlineEditing && !partialSettlement && !viewingCompleteSlot && cards.length > 0 ? (
          <FreestyleBottomActions
            cards={cards}
            viewingCompleteSlot={viewingCompleteSlot}
            canGoPrevious={canGoPrevious}
            visualIndex={visualIndex}
            roundComplete={roundComplete}
            viewingCardId={viewingCardId}
            pendingRestudyCardIds={pendingRestudyCardIds}
            canCompleteRound={canCompleteRound}
            completeTitle={completeTitle}
            topSlot={
              <FreestyleBedtimeButton
                onClick={() => void openBedtimeDialog()}
                busy={bedtimeBusy}
              />
            }
            onPrevious={navigatePrevious}
            onNext={navigateNext}
            onComplete={handlePagerComplete}
          />
        ) : null}

        {/* The closing page hides the pager, but 睡前复习 is exactly what a
            finished evening needs: keep the moon reachable on that page. */}
        {!inlineEditing && !partialSettlement && viewingCompleteSlot && queueState.roundId ? (
          <div className="pointer-events-none absolute right-1 top-[calc(50%+var(--fs-hud-half,2.25rem))] z-30 -translate-y-1/2 sm:right-3">
            <div className="freestyle-stage-glass pointer-events-auto flex flex-col rounded-2xl border border-stage-line-strong p-1 sm:p-1.5">
              <FreestyleBedtimeButton
                onClick={() => void openBedtimeDialog()}
                busy={bedtimeBusy}
              />
            </div>
          </div>
        ) : null}
        <ConfirmDialog
          open={bedtimeOpen}
          onOpenChange={setBedtimeOpen}
          title="睡前复习"
          description={bedtimeDescription}
          confirmText="开始睡前复习"
          confirmDisabled={bedtimeBusy || bedtimeCount == null || bedtimeCount === 0}
          onConfirm={() => { void confirmBedtimeReview() }}
          onCancel={() => setBedtimeOpen(false)}
        />
        {palaceJoin ? (
          <FreestylePalaceJoinDialog
            state={palaceJoin}
            busy={palaceJoinBusy}
            onCancel={cancelPalaceJoin}
            onJoin={confirmPalaceJoin}
            onEdit={editPalace}
            onReopen={confirmPalaceJoin}
          />
        ) : null}
      </div>
      </FreestylePalaceDirectoryPanel>
    </TooltipProvider>
  )
}
