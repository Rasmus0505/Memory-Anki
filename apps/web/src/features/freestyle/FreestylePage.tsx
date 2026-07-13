import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useAiRunConfigDialog } from '@/entities/ai-runtime'
import { FreestyleActionRail, FreestyleStatsPill } from '@/features/freestyle/components/FreestyleActionRail'
import { FreestyleCardScroller } from '@/features/freestyle/components/FreestyleCardScroller'
import { FreestyleDialogsHost } from '@/features/freestyle/components/FreestyleDialogsHost'
import { FreestyleHudBar } from '@/features/freestyle/components/FreestyleHudBar'
import { useFreestyleFeed } from '@/features/freestyle/hooks/useFreestyleFeed'
import { useFreestyleQuizFlow } from '@/features/freestyle/hooks/useFreestyleQuizFlow'
import { usePrefersReducedMotion } from '@/features/freestyle/hooks/usePrefersReducedMotion'
import { useTodayTraining } from '@/features/freestyle/hooks/useTodayTraining'
import { readFreestyleConfig, type FreestyleConfig } from '@/features/freestyle/model/freestyle'
import { readTodayTrainingConfig, type FreestyleMode, type TodayTrainingConfig } from '@/features/freestyle/model/today-training'
import { isActionCard, isQuizCard } from '@/features/freestyle/model/freestyle-cards'
import type { FreestyleCard } from '@/shared/api/contracts'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { cn } from '@/shared/lib/utils'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { clearPageHistorySnapshot } from '@/shared/page-history/pageHistoryStore'
import { usePageHistoryAdapter } from '@/shared/page-history/usePageHistoryAdapter'

export default function FreestylePage() {
  const location = useLocation()
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  const [mode, setMode] = useState<FreestyleMode>('today')
  const [config, setConfig] = useState<FreestyleConfig>(() => readFreestyleConfig())
  const [todayConfig, setTodayConfig] = useState<TodayTrainingConfig>(() => readTodayTrainingConfig())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [todaySettingsOpen, setTodaySettingsOpen] = useState(false)
  const [memoryLookupOpen, setMemoryLookupOpen] = useState(false)
  const memoryLookupHistoryRef = useRef(false)
  const [explainSheetOpen, setExplainSheetOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [wrongQuestionsOpen, setWrongQuestionsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Record<string, HTMLElement | null>>({})
  const requestedScrollIndexRef = useRef<number | null>(null)
  const queueRef = useRef<FreestyleCard[]>([])
  const reducedMotion = usePrefersReducedMotion()
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const {
    feedCards,
    todaySources,
    feedLoading,
    feedError,
    palaceOptions,
    loadFeed,
    loadTodayFeed,
    handleCopyFeedDiagnostics,
    updateFeedQuestion,
    setFeedError,
    setFeedLoading,
  } = useFreestyleFeed({ mode, config, todayConfig })

  const timer = useTimedSession({
    kind: 'quiz',
    title: '随心模式',
    palaceId: null,
    automationScene: 'freestyle',
    sourceKind: null,
    persistKey: 'freestyle',
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
    setProgress,
    setProgressAndPersist,
    updateQuestionState,
    handleChoiceResolve,
    handleShortAnswerSubmit,
    handleShortAnswerFeedback,
    handleClearLocalProgress,
    answeredQuestionIds,
    queuePriorityResolvedIdsRef,
    resetRuntimeRefs,
  } = useFreestyleQuizFlow({
    mode,
    queueRef,
    timer,
    reducedMotion,
    promptForAiOptions,
    updateFeedQuestion,
  })

  const {
    queue,
    summaryVisible,
    canCompleteRound,
    currentIndex,
    currentCard,
    setConfigAndPersist,
    setTodayConfigAndPersist,
    handleReshuffle,
    switchMode,
    todaySummary,
  } = useTodayTraining({
    mode,
    setMode,
    config,
    setConfig,
    todayConfig,
    setTodayConfig,
    feedCards,
    todaySources,
    feedLoading,
    feedError,
    progress,
    setProgress,
    setProgressAndPersist,
    queuePriorityResolvedIdsRef,
    resetRuntimeRefs,
    setFeedError,
    setFeedLoading,
    timer,
  })
  const currentPalaceId = currentCard?.palace_context?.id ?? null
  queueRef.current = queue

  usePageHistoryAdapter({
    location,
    ready: !feedLoading,
    capture: () => ({
      completionState: { summaryVisible },
    }),
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
    if (requestedScrollIndexRef.current !== currentIndex) return
    requestedScrollIndexRef.current = null
    const target = currentCard
      ? cardRefs.current[currentCard.id]
      : summaryVisible
        ? cardRefs.current.__today_summary__
        : null
    target?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [currentCard, currentIndex, summaryVisible])

  const goToIndex = useCallback(
    (index: number) => {
      if (queue.length === 0) return
      const maxIndex = mode === 'today' && canCompleteRound ? queue.length : queue.length - 1
      const nextIndex = Math.max(0, Math.min(index, maxIndex))
      requestedScrollIndexRef.current = nextIndex
      timer.registerActivity('practice_interaction', { source: 'freestyle_nav' })
      setProgressAndPersist((current) => ({
        ...current,
        currentIndex: nextIndex,
      }))
    },
    [canCompleteRound, mode, queue.length, setProgressAndPersist, timer],
  )

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element || queue.length === 0) return
    const nextIndex = Math.max(
      0,
      Math.min(
        mode === 'today' && canCompleteRound ? queue.length : queue.length - 1,
        Math.round(element.scrollTop / Math.max(1, element.clientHeight)),
      ),
    )
    if (nextIndex === progress.currentIndex) return
    setProgressAndPersist((current) => ({
      ...current,
      currentIndex: nextIndex,
    }))
  }, [canCompleteRound, mode, progress.currentIndex, queue.length, setProgressAndPersist])

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
    },
    [currentIndex, goToIndex],
  )


  const openMemoryLookup = useCallback(() => {
    if (!currentPalaceId) return
    if (!memoryLookupHistoryRef.current) {
      window.history.pushState({ ...window.history.state, memoryAnkiFreestyleLookup: true }, '', window.location.href)
      memoryLookupHistoryRef.current = true
    }
    setMemoryLookupOpen(true)
  }, [currentPalaceId])

  const closeMemoryLookup = useCallback((open: boolean) => {
    if (open) { openMemoryLookup(); return }
    setMemoryLookupOpen(false)
    if (memoryLookupHistoryRef.current) {
      memoryLookupHistoryRef.current = false
      window.history.back()
    }
  }, [openMemoryLookup])

  useEffect(() => {
    const handlePopState = () => {
      if (!memoryLookupHistoryRef.current) return
      memoryLookupHistoryRef.current = false
      setMemoryLookupOpen(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const quizTotal = queue.filter(isQuizCard).length
  const actionTotal = queue.filter(isActionCard).length
  const resolvedCount = queue.filter(
    (card) => isQuizCard(card) && answeredQuestionIds.has(card.question.id),
  ).length
  const freshCount = Math.max(0, quizTotal - resolvedCount)
  const openSettings = () => {
    if (mode === 'today') {
      setTodaySettingsOpen(true)
    } else {
      setSettingsOpen(true)
    }
  }

  const handleStartWrongRetrain = useCallback(() => {
    switchMode('free')
    setConfigAndPersist((current) => ({
      ...current,
      range: 'wrong',
      contentTypes: {
        ...current.contentTypes,
        quiz_question: true,
      },
    }))
  }, [setConfigAndPersist, switchMode])

  const handleRestartRound = useCallback(() => {
    clearPageHistorySnapshot('freestyle')
    handleReshuffle()
  }, [handleReshuffle])

  const handleClearProgress = useCallback(async () => {
    clearPageHistorySnapshot('freestyle')
    await handleClearLocalProgress()
  }, [handleClearLocalProgress])

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative max-w-full overflow-hidden bg-zinc-950 text-zinc-50 shadow-2xl',
          'min-h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom,0px))] rounded-lg lg:min-h-[calc(100vh-88px)]',
        )}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <FreestyleDialogsHost
          aiRunConfigDialog={aiRunConfigDialog}
          settingsOpen={settingsOpen}
          todaySettingsOpen={todaySettingsOpen}
          memoryLookupOpen={memoryLookupOpen}
          explainSheetOpen={explainSheetOpen}
          historyOpen={historyOpen}
          wrongQuestionsOpen={wrongQuestionsOpen}
          config={config}
          todayConfig={todayConfig}
          palaceOptions={palaceOptions}
          currentCard={currentCard}
          currentPalaceId={currentPalaceId}
          mode={mode}
          onSettingsOpenChange={setSettingsOpen}
          onTodaySettingsOpenChange={setTodaySettingsOpen}
          onMemoryLookupOpenChange={closeMemoryLookup}
          onExplainSheetOpenChange={setExplainSheetOpen}
          onHistoryOpenChange={setHistoryOpen}
          onWrongQuestionsOpenChange={setWrongQuestionsOpen}
          onStartWrongRetrain={handleStartWrongRetrain}
          onConfigChange={setConfigAndPersist}
          onTodayConfigChange={setTodayConfigAndPersist}
          onClearProgress={() => void handleClearProgress()}
        />

        <FreestyleHudBar
          mode={mode}
          queueLength={queue.length}
          summaryVisible={summaryVisible}
          currentIndex={currentIndex}
          quizTotal={quizTotal}
          freshCount={freshCount}
          correctStreak={progress.correctStreak}
          timerStatus={timer.status}
          effectiveSeconds={timer.effectiveSeconds}
          onSwitchMode={switchMode}
        />

        <FreestyleCardScroller
          scrollRef={scrollRef}
          cardRefs={cardRefs}
          feedLoading={feedLoading}
          feedError={feedError}
          mode={mode}
          config={config}
          todayConfig={todayConfig}
          queue={queue}
          canCompleteRound={canCompleteRound}
          progressQuestionStates={progress.questionStates}
          answeredQuestionIds={answeredQuestionIds}
          todaySummary={todaySummary}
          onScroll={handleScroll}
          onLoadFeed={loadFeed}
          onLoadTodayFeed={loadTodayFeed}
          onCopyDiagnostics={handleCopyFeedDiagnostics}
          onSwitchMode={switchMode}
          onReshuffle={handleRestartRound}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPalace={openMemoryLookup}
          onQuestionStateChange={updateQuestionState}
          onChoiceResolve={handleChoiceResolve}
          onShortAnswerSubmit={(card) => {
            timer.registerActivity('practice_interaction', { source: 'freestyle_short_submit' })
            handleShortAnswerSubmit(card)
          }}
          onRequestShortAnswerFeedback={(card) => void handleShortAnswerFeedback(card)}
        />

        <FreestyleActionRail
          mode={mode}
          currentIndex={currentIndex}
          queueLength={queue.length}
          currentPalaceId={currentPalaceId}
          hasQuizCard={isQuizCard(currentCard)}
          onGoToIndex={goToIndex}
          onReshuffle={handleRestartRound}
          onOpenMemoryLookup={openMemoryLookup}
          onOpenExplainSheet={() => setExplainSheetOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenWrongQuestions={() => setWrongQuestionsOpen(true)}
          onOpenSettings={openSettings}
          onClearLocalProgress={() => void handleClearProgress()}
        />

        <FreestyleStatsPill
          freshCount={freshCount}
          resolvedCount={resolvedCount}
          actionTotal={actionTotal}
        />
      </div>
    </TooltipProvider>
  )
}
