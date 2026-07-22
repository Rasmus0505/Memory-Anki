import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from 'react'
import { History, RefreshCw, Settings2, SkipForward, Undo2 } from 'lucide-react'
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
  const autoAdvanceTimerRef = useRef<number | null>(null)
  const pauseAutoAdvanceRef = useRef(false)
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
    skipCurrent,
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

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const targetTop = currentIndex * node.clientHeight
    node.scrollTo({
      top: targetTop,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }, [currentIndex, reducedMotion, cards.length])

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current != null) {
      window.clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  const scheduleAdvance = useCallback(() => {
    clearAutoAdvance()
    if (reducedMotion || pauseAutoAdvanceRef.current) {
      goToIndex(currentIndex + 1)
      return
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      if (!pauseAutoAdvanceRef.current) {
        goToIndex(currentIndex + 1)
      }
    }, 800)
  }, [clearAutoAdvance, currentIndex, goToIndex, reducedMotion])

  const handleBranchComplete = useCallback(
    (cardId: string) => {
      if (saveError) return
      completeCard(cardId)
      scheduleAdvance()
    },
    [completeCard, saveError, scheduleAdvance],
  )

  const handleQuizResolved = useCallback(
    (card: FreestyleQuizCard) => {
      completeCard(card.id)
      scheduleAdvance()
    },
    [completeCard, scheduleAdvance],
  )

  const onChoiceResolve = useCallback(
    (card: FreestyleQuizCard, optionId: string, isCorrect: boolean) => {
      handleChoiceResolve(card, optionId, isCorrect)
      handleQuizResolved(card)
    },
    [handleChoiceResolve, handleQuizResolved],
  )

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
      const element = event.currentTarget
      if (!element.clientHeight || cards.length === 0) return
      const nextIndex = Math.max(
        0,
        Math.min(cards.length - 1, Math.round(element.scrollTop / element.clientHeight)),
      )
      timer.registerActivity('practice_interaction', { source: 'freestyle_scroll' })
      if (nextIndex !== currentIndex) goToIndex(nextIndex)
    },
    [cards.length, currentIndex, goToIndex, timer],
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
        goToIndex(currentIndex + 1)
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        goToIndex(currentIndex - 1)
      }
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        skipCurrent()
      }
    },
    [currentIndex, goToIndex, skipCurrent],
  )

  const mindmapCount = cards.filter(isMindMapBranchCard).length
  const quizCount = cards.filter(isQuizCard).length
  const resolvedQuiz = cards.filter(
    (card) => isQuizCard(card) && answeredQuestionIds.has(card.question.id),
  ).length

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative max-w-full overflow-hidden bg-zinc-950 text-zinc-50 shadow-2xl',
          'min-h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom,0px))] rounded-lg lg:min-h-[calc(100vh-88px)]',
        )}
        onKeyDown={handleKeyDown}
        onPointerDown={() => {
          pauseAutoAdvanceRef.current = true
          clearAutoAdvance()
        }}
        onPointerUp={() => {
          pauseAutoAdvanceRef.current = false
        }}
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

        {/* Compact top HUD */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-zinc-950/85 px-3 py-2 text-xs shadow-lg backdrop-blur">
            <span className="font-medium text-emerald-200">随心</span>
            <span className="text-zinc-600">·</span>
            <span className="tabular-nums text-zinc-300">
              {cards.length === 0 ? '0/0' : `${currentIndex + 1}/${cards.length}`}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400">
              导图{mindmapCount} · 题{quizCount}
            </span>
            {resolvedQuiz > 0 ? (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-emerald-300">已答{resolvedQuiz}</span>
              </>
            ) : null}
          </div>
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-zinc-950/85 p-1 shadow-lg backdrop-blur">
            <span className="px-2 text-[11px] tabular-nums text-zinc-400">
              {formatTimer(timer.effectiveSeconds)}
            </span>
            <button
              type="button"
              className={cn(
                'rounded-full px-2.5 py-1.5 text-[11px]',
                ratingMode ? 'bg-amber-300/20 text-amber-100' : 'text-zinc-400',
              )}
              onClick={() => setRatingMode((value) => !value)}
            >
              评分{ratingMode ? '开' : '关'}
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-zinc-300 hover:bg-white/10"
              title="刷新队列"
              onClick={refreshQueue}
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-zinc-300 hover:bg-white/10"
              title="历史"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-3.5" />
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-zinc-300 hover:bg-white/10"
              title="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        </div>

        {saveError ? (
          <div className="absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full border border-rose-400/30 bg-rose-950/90 px-4 py-2 text-xs text-rose-100">
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
          className={cn(
            'snap-y snap-mandatory overflow-y-auto overflow-x-hidden overscroll-contain',
            'h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom,0px))] lg:h-[calc(100vh-88px)]',
          )}
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
            />
          ) : (
            cards.map((card, index) => {
              if (!mounted.has(index)) {
                return (
                  <div
                    key={card.id}
                    className="h-full min-h-[calc(100dvh-5.5rem)] snap-start snap-always lg:min-h-[calc(100vh-88px)]"
                    aria-hidden
                  />
                )
              }
              return (
                <div
                  key={card.id}
                  className="box-border h-full min-h-[calc(100dvh-5.5rem)] snap-start snap-always px-3 pb-24 pt-16 sm:px-4 lg:min-h-[calc(100vh-88px)]"
                >
                  {isMindMapBranchCard(card) ? (
                    <FreestyleMindMapBranchCardView
                      card={card}
                      active={index === currentIndex}
                      ratingMode={ratingMode}
                      onToggleRatingMode={() => setRatingMode((value) => !value)}
                      onBranchComplete={handleBranchComplete}
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
                        handleShortAnswerSubmit(card)
                        handleQuizResolved(card)
                      }}
                      onRequestShortAnswerFeedback={() => {
                        void handleShortAnswerFeedback(card)
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

        {/* Desktop right / mobile thumb actions */}
        <div
          className={cn(
            'pointer-events-none absolute z-20 flex flex-col gap-2',
            'right-3 top-1/2 -translate-y-1/2',
            'max-lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] max-lg:right-3 max-lg:top-auto max-lg:translate-y-0 max-lg:flex-row',
          )}
        >
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-white/10 bg-zinc-950/85 p-3 text-zinc-100 shadow-lg backdrop-blur"
            title="跳过"
            onClick={skipCurrent}
          >
            <SkipForward className="size-4" />
          </button>
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-white/10 bg-zinc-950/85 px-3 py-2 text-xs text-zinc-100 shadow-lg backdrop-blur"
            title="下一项"
            onClick={() => goToIndex(currentIndex + 1)}
          >
            下一项
          </button>
          {canUndoSkip ? (
            <button
              type="button"
              className="pointer-events-auto rounded-full border border-white/10 bg-zinc-950/85 p-3 text-zinc-100 shadow-lg backdrop-blur"
              title="撤销跳过"
              onClick={undoLastSkip}
            >
              <Undo2 className="size-4" />
            </button>
          ) : null}
          {currentCard ? (
            <button
              type="button"
              className="pointer-events-auto rounded-full border border-white/10 bg-zinc-950/85 px-3 py-2 text-[11px] text-zinc-300 shadow-lg backdrop-blur"
              onClick={muteCurrentPalace}
            >
              少看此宫殿
            </button>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
}
