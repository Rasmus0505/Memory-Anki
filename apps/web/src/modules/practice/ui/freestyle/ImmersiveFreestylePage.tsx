import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { RefreshCw } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FreestyleProgressRail } from '@/modules/practice/ui/freestyle/components/FreestyleProgressRail'
import { FreestyleRailParticles } from '@/modules/practice/ui/freestyle/components/FreestyleRailParticles'
import { FreestyleRoundCompleteCard } from '@/modules/practice/ui/freestyle/components/FreestyleRoundCompleteCard'
import {
  buildFreestyleProgressSummary,
  cardAmbientHsl,
  liveEncounterFillDone,
  retryChromeClass,
} from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
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
  freestyleCanPageNext,
  isFreestyleRoundComplete,
} from '@/modules/practice/ui/freestyle/model/roundCompletion'
import type { FreestylePartialSettlementSnapshot } from '@/modules/practice/domain/partialSettlement'
import { compressibleRoundPlanIds, createOperationId } from '@/modules/practice/public'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleRoundConfigDialog } from '@/modules/practice/ui/freestyle/components/FreestyleRoundConfigDialog'
import type { FreestyleConfigSaveChoice } from '@/modules/practice/ui/freestyle/model/overlapProgressChoice'
import { overlayQuizRangeLabel, overlayReviewPalaceIds } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import { FreestyleScopeQuizDialog } from '@/modules/practice/ui/freestyle/components/FreestyleDialogsHost'
import { FreestyleRoundSheet } from '@/modules/practice/ui/freestyle/components/FreestyleRoundSheet'
import { FreestyleUnitReviewCardView } from '@/modules/practice/ui/freestyle/components/FreestyleUnitReviewCardView'
import { FreestyleQuizCardView } from '@/modules/practice/ui/freestyle/components/FreestyleQuizCardView'
import { FreestyleReviewHintCardView } from '@/modules/practice/ui/freestyle/components/FreestyleReviewHintCardView'
import {
  FreestyleEmptyState,
  FreestyleFeedErrorState,
  FreestyleLoadingState,
} from '@/modules/practice/ui/freestyle/components/FreestyleFeedStates'
import {
  FreestyleHudOverflow,
  FreestyleStaleRecoveryPanel,
  FreestyleTopNotices,
  FreestyleWorkspaceSwitcher,
} from '@/modules/practice/ui/freestyle/components/FreestyleHudChrome'
import { FreestyleRatingReaction } from '@/modules/practice/ui/freestyle/components/FreestyleRatingReaction'
import { FreestyleKeyCardMotes } from '@/modules/practice/ui/freestyle/components/FreestyleKeyCardMotes'
import { cue } from '@/shared/fx'
import { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import { useFreestyleQuizFlow } from '@/modules/practice/ui/freestyle/hooks/useFreestyleQuizFlow'
import { useFreestyleFeedNavigation } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFeedNavigation'
import { useFreestyleLiveSync } from '@/modules/practice/ui/freestyle/hooks/useFreestyleLiveSync'
import { useFreestyleChallengeChannel } from '@/modules/practice/ui/freestyle/hooks/useFreestyleChallengeChannel'
import { usePalaceClearanceWatch } from '@/modules/practice/ui/freestyle/hooks/usePalaceClearanceWatch'
import { useFreestyleFullscreen } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFullscreen'
import { useFreestyleDisplayPrefs } from '@/modules/practice/ui/freestyle/hooks/useFreestyleDisplayPrefs'
import { useFreestyleSubjectMap } from '@/modules/practice/ui/freestyle/hooks/useFreestyleSubjectMap'
import { resetFreestyleCombo } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { parseFreestyleEntryPalaceId } from '@/modules/practice/ui/freestyle/model/freestyle-entry-scope'
import {
  isMindMapBranchCard,
  isQuizCard,
} from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { FreestyleChannelHint } from '@/modules/practice/ui/freestyle/components/FreestyleChannelHint'
import { FreestyleFeedPager } from '@/modules/practice/ui/freestyle/components/FreestyleFeedPager'
import { FreestylePalaceClearedBanner } from '@/modules/practice/ui/freestyle/components/FreestylePalaceClearedBanner'
import { useFreestyleChromeTheme } from '@/modules/practice/ui/freestyle/hooks/useFreestyleChromeTheme'
import { useFreestyleRoundLearningClock } from '@/modules/practice/ui/freestyle/hooks/useFreestyleRoundLearningClock'
import { useFreestyleWakeLock } from '@/modules/practice/ui/freestyle/hooks/useFreestyleWakeLock'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import {
  cardPalaceId,
  RESTUDY_MAX_INTERVENING,
  FREESTYLE_WORKSPACE_PRIMARY,
  FREESTYLE_WORKSPACE_SECONDARY,
  isQueueStateFromPreviousDay,
  type FreestyleWorkspaceId,
  type UnitRating,
  freestyleWorkspacePath,
  normalizeFreestyleWorkspaceId,
  readFreestyleFeedConfig,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig, FreestyleQuizCard } from '@/shared/api/contracts'
import { isReviewHintCard } from '@/shared/api/contracts'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { toast } from '@/shared/feedback/toast'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { cn } from '@/shared/lib/utils'
import { ExamCountdownChip, ExamRoundSummary, ExamStarBadge, useExamOverview } from '@/modules/exam/public'
import { GrowthHudChip, GrowthRoundSettlement } from '@/modules/progression/public'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

const FREESTYLE_STALE_TOAST_ID = 'freestyle-stale-card'

function examStarsOf(card: object): number | null {
  const value = (card as { exam_stars?: number }).exam_stars
  return typeof value === 'number' && value >= 1 ? Math.min(3, Math.round(value)) : null
}

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
    <div className="flex h-full items-center justify-center text-sm text-stage-muted">
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
  const queueRef = useRef<FreestyleCard[]>([])
  const acknowledgedCardIdsRef = useRef<Set<string>>(new Set())
  const autoAdvanceTimerRef = useRef<number | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [partialSettlement, setPartialSettlement] = useState<FreestylePartialSettlementSnapshot | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  /** Settlement 「再来一轮」 opens config in nextRound mode; HUD uses replan. */
  const [configIntent, setConfigIntent] = useState<'replan' | 'nextRound'>('replan')
  const [scopeQuizOpen, setScopeQuizOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { promptForAiOptions } = useAiRunConfigDialog()
  const [yesterdayHintDismissed, setYesterdayHintDismissed] = useState(false)
  const [inlineEditing, setInlineEditing] = useState(false)
  const [sheetRatingRequest, setSheetRatingRequest] = useState<{ cardId: string; rating: UnitRating } | null>(null)
  const { flipMode, mindmapZoom, updateFlipMode, updateMindmapZoom } = useFreestyleDisplayPrefs()
  const { freestyleFullscreen, toggleFreestyleFullscreen } = useFreestyleFullscreen()
  const subjectByPalaceId = useFreestyleSubjectMap()

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
    buildQueue,
    pendingRestudyCardIds,
    planVersion,
    adoptRoundVersion,
    hydrateLiveRound,
    clearConfiguredOverlayQuiz,
    queueFrozen,
    startupVisualIndex,
    clearStartupVisualIndex,
  } = useImmersiveQueue(entryPalaceId, slot)

  const saveFreestyleConfig = useCallback((
    nextConfig: FreestyleFeedConfig,
    choice: FreestyleConfigSaveChoice = 'keep-overlap',
  ) => {
    resetStaleRecovery()
    if (configIntent === 'nextRound' || choice === 'start-fresh') {
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

  queueRef.current = cards
  const { signalPageTurn } = useFreestyleFlowFeedback()
  const signalPageTurnWithDust = useCallback((direction: 'forward' | 'backward') => {
    signalPageTurn(direction)
    cue('page.turn', {})
  }, [signalPageTurn])
  const currentCard = cards[currentIndex] ?? null
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
    scrollChannel,
    edgeHint,
  } = useFreestyleFeedNavigation({
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
    onStartupVisualApplied: clearStartupVisualIndex,
    onPageTurn: isActive ? signalPageTurnWithDust : undefined,
  })
  const {
    recordChannelSample,
    channelReading,
    activeChannelAdjustment,
    channelHintVisible,
    channelAdjusting,
    channelAppliedHint,
    setChannelAppliedHint,
    suppressChannelHint,
    handleApplyChannelAdjustment,
  } = useFreestyleChallengeChannel({
    config,
    cardCount: cards.length,
    currentCardId: currentCard?.id ?? null,
    roundComplete,
    loading,
    error,
    setConfigAndPersist,
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

  const learningClock = useFreestyleRoundLearningClock({
    roundId: queueState.roundId,
    planVersion,
    adoptRoundVersion,
    isActive,
    // Pause only while the settlement slot is on screen. 上一张 / 取消结算
    // leaves that slot; later card dwell and 做题 still accumulate.
    viewingCard: !viewingCompleteSlot && currentCard != null,
    cardPalaceId: currentCard ? cardPalaceId(currentCard) : null,
    publishLive: viewingCompleteSlot,
  })

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

  const { liveRevealMap, applyLiveRevealMap } = useFreestyleLiveSync({
    fullPath,
    entryPalaceId,
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

  const sequentialBlockedHint = null

  const { data: examOverview } = useExamOverview()
  // Snapshot at round start so the settlement can show what this round lit up.
  const examBaselineRef = useRef<{ roundId: string; overview: NonNullable<typeof examOverview> } | null>(null)
  if (examOverview && examBaselineRef.current?.roundId !== queueState.roundId) {
    examBaselineRef.current = { roundId: queueState.roundId, overview: examOverview }
  }

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
        learningTime: learningClock.ready ? learningClock.learningTime : null,
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
      roundPlan?.partialSettlements,
      cards.map((card) => card.id),
    ),
    [
      answeredQuestionIds,
      cards,
      queueState.completedIds,
      queueState.unitEncountersByCardId,
      roundMeta.candidate_count,
      roundMeta.scheduled_count,
      learningClock.learningTime,
      learningClock.ready,
      roundPlan,
      subjectByPalaceId,
    ],
  )

  const mindmapCount = cards.filter(isMindMapBranchCard).length
  const quizCount = cards.filter(isQuizCard).length
  const resolvedQuiz = cards.filter(
    (card) => isQuizCard(card) && answeredQuestionIds.has(card.question.id),
  ).length

  const overflowSummary = cards.length === 0
    ? `本轮 0 张 · 候选 ${roundMeta.candidate_count} · 上限 ${roundMeta.queue_limit}`
    : `导图 ${mindmapCount} · 题 ${quizCount}${resolvedQuiz > 0 ? ` · 已答 ${resolvedQuiz}` : ''} · 候选 ${roundMeta.candidate_count}`
  const openPlan = useCallback(() => setPlanOpen(true), [])
  const jumpFromProgressRail = useCallback((cardId: string) => {
    const index = cards.findIndex((card) => card.id === cardId)
    if (index < 0) {
      setPlanOpen(true)
      return
    }
    navigateToIndex(index)
  }, [cards, navigateToIndex])
  const openHistory = useCallback(() => setHistoryOpen(true), [])
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

  // Stable overflow tree: recreating DropdownMenuTrigger every parent render
  // under TooltipProvider loops Radix composeRefs (Vite Maximum update depth).
  const progressRailOverflow = useMemo(() => (
    <FreestyleHudOverflow
      summaryLabel={overflowSummary}
      slot={slot}
      onOpenPlan={openPlan}
      onSyncProgress={syncComputerProgress}
      onOpenHistory={openHistory}
    />
  ), [openHistory, openPlan, overflowSummary, slot, syncComputerProgress])

  return (
    <TooltipProvider>
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
          onCompressCompleted={() => {
            const ids = compressibleRoundPlanIds(roundPlan, {
              completedIds: queueState.completedIds,
              encounters: queueState.unitEncountersByCardId,
            })
            if (!ids.length) return
            const snapshot = buildPartialSettlementSnapshot({
              id: createOperationId(),
              cardIds: ids,
              cards,
              encountersByCardId: queueState.unitEncountersByCardId,
              completedIds: queueState.completedIds,
              roundPlan,
              subjectByPalaceId,
              quizCount: ids.filter((id) => {
                const card = cards.find((item) => item.id === id)
                return Boolean(card && isQuizCard(card) && answeredQuestionIds.has(card.question.id))
              }).length,
            })
            setPlanOpen(false)
            if (snapshot) setPartialSettlement(snapshot)
          }}
          onReorder={reorderPlan}
          onRateCard={(cardId, rating) => {
            const index = cards.findIndex((card) => card.id === cardId)
            if (index < 0) return
            setSheetRatingRequest({ cardId, rating })
            if (index !== currentIndex) navigateToIndex(index)
          }}
          onRemoveCard={removeCardFromQueue}
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
          rangeLabel={overlayQuizRangeLabel(overlayReviewPalaceIds(roundPlan, config).length)}
          palaceCount={overlayReviewPalaceIds(roundPlan, config).length}
          onConfirmSetup={({
            quizScope,
            overlayQuestionRange,
            overlayQuestionKinds,
            overlayTypeOrder,
            overlayTypePalaceNesting,
          }) => {
            setConfigAndPersist((current) => ({
              ...current,
              overlay_quiz_setup_done: true,
              quiz_scope: quizScope,
              overlay_question_range: overlayQuestionRange,
              overlay_question_kinds: overlayQuestionKinds,
              overlay_type_order: overlayTypeOrder,
              overlay_type_palace_nesting: overlayTypePalaceNesting,
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

        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+1.85rem)] z-30 flex justify-center gap-1.5 px-[5.75rem] sm:px-36">
          {examOverview?.settings.exam_date ? <ExamCountdownChip overview={examOverview} className="pointer-events-auto max-w-full" /> : null}
          <GrowthHudChip className="pointer-events-auto shrink-0" />
        </div>
        <FreestyleProgressRail
          summary={progressSummary}
          scrollChannel={scrollChannel}
          workspaceSwitcher={<FreestyleWorkspaceSwitcher slot={slot} />}
          onOpenPlan={openPlan}
          onJump={jumpFromProgressRail}
          overflow={progressRailOverflow}
        />
        <FreestyleRailParticles segments={progressSummary.segments} />

        <FreestyleTopNotices
          showYesterday={!yesterdayHintDismissed && isQueueStateFromPreviousDay(queueState)}
          onDismissYesterday={() => setYesterdayHintDismissed(true)}
          channelAppliedHint={channelAppliedHint}
          onDismissChannelApplied={() => setChannelAppliedHint('')}
          saveError={saveError}
          onDismissSaveError={() => setSaveError('')}
        />

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
          <FreestyleStaleRecoveryPanel
            onSkip={handleSkipStaleRecovery}
            onRebuild={handleRebuildStaleRecovery}
            onOpenConfig={handleOpenStaleConfig}
          />
        ) : null}

        <div
          ref={scrollRef}
          data-page-history-scroll-key="freestyle-immersive"
          // overflow-anchor-none: reordering cards for「下个宫殿」must not let the
          // browser keep the old card glued to the viewport (looks like no jump).
          data-testid="freestyle-feed-scroller"
          className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-y-none [overflow-anchor:none] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
                  className="fs-page relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always p-0"
                  style={{ '--fs-ambient': cardAmbientHsl(card) } as CSSProperties}
                >
                  {/* Depth stack layer (styles/freestyle-stage.css): scroll-driven rise-in and
                      recede. Keeps the 6px progress rail band on the dark shell for PWA. */}
                  <div className="fs-depth flex min-h-0 flex-1 flex-col pt-[calc(env(safe-area-inset-top,0px)+4.75rem)]">
                  <FreestyleRatingReaction
                    active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
                  >
                    <div
                      className="relative flex min-h-0 flex-1 flex-col"
                      data-exam-stars={examStarsOf(card) ?? undefined}
                    >
                      {examStarsOf(card) === 3 ? (
                        <FreestyleKeyCardMotes
                          active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
                        />
                      ) : null}
                      {examStarsOf(card) ? (
                        <span className="exam-feed-corner" aria-hidden={examStarsOf(card) === 1}>
                          <ExamStarBadge stars={examStarsOf(card) ?? 1} />
                        </span>
                      ) : null}
                      {isMindMapBranchCard(card) ? (
                          card.unit_id && card.unit_revision != null ? (
                            <FreestyleUnitReviewCardView
                              card={card}
                              active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
                              nearViewport={isActive && Math.abs(index - visualIndex) <= 1}
                              readOnly={readOnlyHistoryCardId === card.id}
                              roundId={queueState.roundId}
                              planVersion={planVersion}
                              encounter={queueState.unitEncountersByCardId[card.id]}
                              lastRating={roundPlan?.cardsById[card.id]?.lastRating ?? null}
                              requestedRating={sheetRatingRequest?.cardId === card.id ? sheetRatingRequest.rating : null}
                              onRequestedRatingHandled={() => setSheetRatingRequest((current) => (
                                current?.cardId === card.id ? null : current
                              ))}
                              retryAfterCards={RESTUDY_MAX_INTERVENING}
                              fullscreen={freestyleFullscreen && index === currentIndex}
                              onToggleFullscreen={toggleFreestyleFullscreen}
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
                              onRemoveFromQueue={removeCardFromQueue}
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
                              onOpenScopeQuiz={openScopeQuiz}
                            />
                          ) : (
                            <StaleUnitReviewCard
                              cardId={card.id}
                              onStaleDrop={handleStaleDrop}
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
                      ) : isReviewHintCard(card) ? (
                        <FreestyleReviewHintCardView
                          card={card}
                          active={isActive && index === currentIndex && index === visualIndex && !viewingCompleteSlot}
                          onAdvance={() => {
                            navigateToIndex(index + 1)
                          }}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-stage-muted">
                          暂不支持的卡片类型
                        </div>
                      )}
                    </div>
                  </FreestyleRatingReaction>
                  <FreestyleRetryCornerBadge
                    card={card}
                    retryAfterCards={planEntry?.status === 'retry' ? planEntry.retryAfterCards : undefined}
                    completed={liveEncounterFillDone(
                      queueState.unitEncountersByCardId[card.id],
                      queueState.completedIds.includes(card.id),
                    )}
                  />
                  </div>
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
          ) : roundComplete ? null : (
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
            <div className="fs-page relative box-border flex h-full min-h-0 shrink-0 flex-col snap-start snap-always p-0">
              <div
                data-testid="freestyle-round-complete-scroll"
                className="fs-depth min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[calc(env(safe-area-inset-top,0px)+4.75rem)]"
              >
              <FreestyleRoundCompleteCard
                completion={roundCompletion}
                roundKey={queueState.roundId}
                quizPalaceCount={overlayReviewPalaceIds(roundPlan, config).length}
                onClearQuizProgress={clearConfiguredOverlayQuiz}
                onAnotherRound={() => {
                  setConfigIntent('nextRound')
                  setConfigOpen(true)
                }}
                onCancelSettlement={navigatePrevious}
                partialSettlements={roundPlan?.partialSettlements}
                examSummary={
                  <>
                    <ExamRoundSummary baseline={examBaselineRef.current?.overview ?? null} roundKey={queueState.roundId} />
                    <GrowthRoundSettlement roundKey={queueState.roundId} />
                  </>
                }
              />
              </div>
            </div>
          ) : null}
        </div>
        {partialSettlement ? (
          <div
            data-testid="freestyle-partial-settlement"
            className="absolute inset-0 z-[70] flex flex-col bg-stage/95 backdrop-blur-sm"
          >
            <div className="flex shrink-0 items-center justify-end px-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
              <button
                type="button"
                data-testid="freestyle-partial-settlement-exit"
                className="ma-pressable rounded-full border border-stage-line-strong bg-stage-raised/90 px-4 py-2 text-sm font-medium text-stage-ink shadow-lg"
                onClick={() => setPartialSettlement(null)}
              >
                退出
              </button>
            </div>
            <div className="mx-auto min-h-0 w-full max-w-2xl flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
              <FreestyleRoundCompleteCard
                variant="partial"
                completion={{
                  ratedCount: partialSettlement.ratedCount,
                  passedCount: partialSettlement.passedCount,
                  retriedCount: partialSettlement.retryCount,
                  retryCount: partialSettlement.retryCount,
                  remainingCandidates: 0,
                  quizCount: partialSettlement.quizCount,
                  totalEffectiveSeconds: partialSettlement.totalEffectiveSeconds,
                  quizSeconds: partialSettlement.quizSeconds,
                  bySubject: partialSettlement.bySubject,
                }}
                roundKey={`${queueState.roundId}:${partialSettlement.id}`}
                quizPalaceCount={0}
                onClearQuizProgress={async () => undefined}
                onCancelSettlement={() => setPartialSettlement(null)}
                onConfirmPartial={() => {
                  const snapshot = partialSettlement
                  setPartialSettlement(null)
                  compressCompletedPlanCards(snapshot)
                }}
              />
            </div>
          </div>
        ) : null}
        {edgeHint ? (
          <div key={edgeHint.nonce} role="status" data-edge={edgeHint.edge} className="fs-edge-hint">
            {edgeHint.edge === 'top'
              ? '已经是第一张'
              : roundComplete
                ? '本轮已经到底了'
                : '已经是本轮最后一张'}
          </div>
        ) : null}

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
          previousTitle={
            viewingCompleteSlot
              ? '取消结算，返回上一张'
              : '上一张：返回上一个单元'
          }
          onPrevious={navigatePrevious}
          onNext={navigateNext}
          onComplete={handleCompleteRound}
        />
        ) : null}
      </div>
    </TooltipProvider>
  )
}
