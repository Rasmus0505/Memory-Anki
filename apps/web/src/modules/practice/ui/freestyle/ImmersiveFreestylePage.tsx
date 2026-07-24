import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from 'react'
import {
  EyeOff,
  History,
  RefreshCw,
  Settings2,
  SkipForward,
  Undo2,
  Waypoints,
} from 'lucide-react'
import { FreestyleFeedSettingsDialog } from '@/modules/practice/ui/freestyle/components/FreestyleFeedSettingsDialog'
import { FreestyleHistoryDialog } from '@/modules/practice/ui/freestyle/components/FreestyleHistoryDialog'
import { FreestyleMindMapBranchCardView } from '@/modules/practice/ui/freestyle/components/FreestyleMindMapBranchCardView'
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
import { UNDO_SKIP_WINDOW_MS, visibleMountIndices } from '@/modules/practice/public'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { toast } from '@/shared/feedback/toast'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { cn } from '@/shared/lib/utils'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

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
  const acknowledgedCardIdsRef = useRef<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [ratingMode, setRatingMode] = useState(true)
  const [saveError, setSaveError] = useState('')
  const { promptForAiOptions } = useAiRunConfigDialog()

  const {
    config,
    setConfigAndPersist,
    queueState,
    cards,
    currentIndex,
    goToIndex,
    loading,
    error,
    refreshQueue,
    reshuffleQueue,
    completeCard,
    acknowledgeCard,
    dropStaleCard,
    skipCurrent,
    skipToNextPalace,
    undoLastSkip,
    muteCurrentPalace,
  } = useImmersiveQueue()

  queueRef.current = cards
  const currentCard = cards[currentIndex] ?? null

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
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'freestyle')) return
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
        behavior: behavior ?? (reducedMotion ? 'auto' : 'smooth'),
      })
      window.setTimeout(() => {
        programmaticScrollRef.current = false
      }, reducedMotion ? 50 : 420)
    },
    [reducedMotion],
  )

  /**
   * Navigate the feed index. Programmatic scroll only when `scroll` is true
   * (keyboard / 下一题). Finger/wheel scroll only updates index — never fights
   * the gesture with a second scrollTo / snap takeover.
   */
  const navigateToIndex = useCallback(
    (index: number, options?: { scroll?: boolean }) => {
      const max = Math.max(0, cards.length - 1)
      const next = Math.max(0, Math.min(index, max))
      if (options?.scroll !== false) {
        // Same index: React may bail out of setState; still align the viewport.
        if (next === currentIndex) {
          scrollToIndex(next)
          return
        }
        requestedScrollIndexRef.current = next
      }
      goToIndex(next)
    },
    [cards.length, currentIndex, goToIndex, scrollToIndex],
  )

  useEffect(() => {
    if (requestedScrollIndexRef.current !== currentIndex) return
    requestedScrollIndexRef.current = null
    scrollToIndex(currentIndex)
  }, [currentIndex, scrollToIndex])

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
    (cardId: string, options?: { restudy?: boolean }) => {
      if (saveError) return
      // Successful FSRS only: marks completedIds + silent rebuild; stay on card.
      // Weak ratings (restudy) skip completedIds; never auto-flip to the next unit.
      completeCard(cardId, options)
    },
    [completeCard, saveError],
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

  const [canUndoSkip, setCanUndoSkip] = useState(false)
  useEffect(() => {
    if (!queueState.lastSkippedId || !queueState.lastSkippedAt) {
      setCanUndoSkip(false)
      return
    }
    setCanUndoSkip(true)
    const timerId = window.setTimeout(() => setCanUndoSkip(false), UNDO_SKIP_WINDOW_MS)
    return () => window.clearTimeout(timerId)
  }, [queueState.lastSkippedAt, queueState.lastSkippedId])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (programmaticScrollRef.current) return
      const element = event.currentTarget
      if (!element.clientHeight || cards.length === 0) return
      const nextIndex = Math.max(
        0,
        Math.min(cards.length - 1, Math.round(element.scrollTop / element.clientHeight)),
      )
      timer.registerActivity('practice_interaction', { source: 'freestyle_scroll' })
      if (nextIndex !== currentIndex) {
        // Index only — do not call scrollTo; CSS snap + the user's gesture own the viewport.
        navigateToIndex(nextIndex, { scroll: false })
      }
    },
    [cards.length, currentIndex, navigateToIndex, timer],
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
        navigateToIndex(currentIndex + 1)
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        navigateToIndex(currentIndex - 1)
      }
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        skipCurrent()
      }
    },
    [currentIndex, navigateToIndex, skipCurrent],
  )

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
          // Soft stage: one continuous dark field so card chrome does not float on flat black.
          'bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(52,211,153,0.08),transparent_45%),linear-gradient(180deg,#0c0d10_0%,#09090b_100%)]',
          // Bottom nav (~4.5rem) + shell padding (~1rem) + safe area; keep the feed fully on-screen.
          'h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom,0px))] min-h-0 rounded-xl border border-white/5 shadow-2xl lg:h-[calc(100vh-88px)]',
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

        {/* Compact top HUD — single bar; roomy hit targets on PWA, denser on desktop */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2 pt-2 sm:px-3 sm:pt-2.5">
          <div className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-2xl border border-white/10 bg-zinc-950/88 px-1.5 py-1 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-md sm:gap-1.5 sm:rounded-full sm:px-2 sm:py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 sm:gap-2 sm:px-2">
              <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                随心
              </span>
              <span className="shrink-0 tabular-nums text-sm text-zinc-100">
                {cards.length === 0 ? '0/0' : `${currentIndex + 1}/${cards.length}`}
              </span>
              <span className="hidden min-w-0 truncate text-xs text-zinc-500 md:inline">
                导图 {mindmapCount} · 题 {quizCount}
                {resolvedQuiz > 0 ? ` · 已答 ${resolvedQuiz}` : ''}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-xs text-zinc-400 sm:text-sm">
                {formatTimer(timer.effectiveSeconds)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-1 sm:gap-1 sm:pl-1.5">
              <button
                type="button"
                className={cn(
                  'inline-flex h-10 shrink-0 items-center rounded-full px-2.5 text-xs font-medium sm:h-9 sm:px-2.5',
                  ratingMode
                    ? 'bg-amber-300/20 text-amber-50'
                    : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200',
                )}
                onClick={() => setRatingMode((value) => !value)}
              >
                评分{ratingMode ? '开' : '关'}
              </button>
              <button
                type="button"
                className={hudActionClass}
                title="刷新队列"
                aria-label="刷新队列"
                onClick={refreshQueue}
              >
                <RefreshCw className="size-4" />
              </button>
              <button
                type="button"
                className={hudActionClass}
                title="历史"
                aria-label="历史"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="size-4" />
              </button>
              <button
                type="button"
                className={hudActionClass}
                title="设置"
                aria-label="设置"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2 className="size-4" />
              </button>
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
          className="h-full snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-contain"
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
                  practice: false,
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
                    // HUD top inset only; dock floats over the lower-right of the card so the
                    // mind-map can claim the vertical space that used to be empty padding.
                    'px-2 pb-2 pt-[3.5rem] sm:px-3 sm:pb-3 sm:pt-14',
                  )}
                >
                  {isMindMapBranchCard(card) ? (
                    <FreestyleMindMapBranchCardView
                      card={card}
                      active={index === currentIndex}
                      ratingMode={ratingMode}
                      onToggleRatingMode={() => setRatingMode((value) => !value)}
                      onBranchComplete={handleBranchComplete}
                      onStaleDrop={handleStaleDrop}
                      onSaveFailed={(message) => {
                        setSaveError(message)
                        toast.error(message)
                      }}
                      reducedMotion={reducedMotion}
                    />
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

        {/* One glass action dock: desktop mid-right, PWA over map lower-right (not eating map height) */}
        <div
          className={cn(
            'pointer-events-none absolute z-20',
            'right-3 top-1/2 -translate-y-1/2',
            'max-lg:bottom-[max(0.5rem,env(safe-area-inset-bottom,0px))] max-lg:right-2 max-lg:top-auto max-lg:translate-y-0',
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
              className="inline-flex size-11 items-center justify-center rounded-xl text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 sm:size-10"
              title="跳过当前"
              aria-label="跳过当前"
              onClick={skipCurrent}
            >
              <SkipForward className="size-5 sm:size-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 sm:h-10 sm:flex-col sm:gap-0.5 sm:px-2 sm:py-1"
              title="下个宫殿：本宫殿剩余内容移到队尾"
              aria-label="下个宫殿"
              onClick={skipToNextPalace}
            >
              <Waypoints className="size-4 shrink-0" />
              <span className="leading-none">下个</span>
            </button>
            {canUndoSkip ? (
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-xl text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15 sm:size-10"
                title="撤销跳过"
                aria-label="撤销跳过"
                onClick={undoLastSkip}
              >
                <Undo2 className="size-5 sm:size-4" />
              </button>
            ) : null}
            {currentCard ? (
              <button
                type="button"
                className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100 active:bg-white/15 sm:h-10 sm:flex-col sm:gap-0.5 sm:px-2 sm:py-1"
                title="少看此宫殿"
                aria-label="少看此宫殿"
                onClick={muteCurrentPalace}
              >
                <EyeOff className="size-4 shrink-0" />
                <span className="leading-none">少看</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
