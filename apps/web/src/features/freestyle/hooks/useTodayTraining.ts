import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import {
  buildFreestyleQueue,
  buildQueueSignature,
  nextFreestyleSeed,
  readFreestyleProgress,
  saveFreestyleConfig,
  type FreestyleConfig,
  type FreestyleProgressSnapshot,
} from '@/features/freestyle/model/freestyle'
import { isQuizCard, stringListsEqual } from '@/features/freestyle/model/freestyle-cards'
import { canCompleteRound as domainCanCompleteRound, clampTrainingIndex, freestyleTrainingMachine } from '@/modules/freestyle/public'
import { createActor } from 'xstate'
import {
  buildTodayTrainingQueue,
  buildTodayTrainingSummary,
  nextTodayTrainingSeed,
  readTodayTrainingProgress,
  restoreTodayTrainingQueue,
  saveTodayTrainingConfig,
  type FreestyleMode,
  type TodayTrainingConfig,
  type TodayTrainingQueueSources,
} from '@/features/freestyle/model/today-training'
import type { FreestyleCard } from '@/shared/api/contracts'
import type { useTimedSession } from '@/shared/hooks/useTimedSession'

type FreestyleTimer = ReturnType<typeof useTimedSession>

export function useTodayTraining({
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
}: {
  mode: FreestyleMode
  setMode: Dispatch<SetStateAction<FreestyleMode>>
  config: FreestyleConfig
  setConfig: Dispatch<SetStateAction<FreestyleConfig>>
  todayConfig: TodayTrainingConfig
  setTodayConfig: Dispatch<SetStateAction<TodayTrainingConfig>>
  feedCards: FreestyleCard[]
  todaySources: TodayTrainingQueueSources
  feedLoading: boolean
  feedError: string
  progress: FreestyleProgressSnapshot
  setProgress: (progress: FreestyleProgressSnapshot) => void
  setProgressAndPersist: (
    updater: (current: FreestyleProgressSnapshot) => FreestyleProgressSnapshot
  ) => void
  queuePriorityResolvedIdsRef: MutableRefObject<number[]>
  resetRuntimeRefs: (nextProgress: FreestyleProgressSnapshot) => void
  setFeedError: (error: string) => void
  setFeedLoading: (loading: boolean) => void
  timer: FreestyleTimer
}) {
  const queue = useMemo(
    () => {
      if (mode === 'today') {
        if (progress.activeQueueIds.length > 0) {
          return restoreTodayTrainingQueue(todaySources, progress.activeQueueIds)
        }
        return buildTodayTrainingQueue(todaySources, todayConfig, {
          resolvedQuestionIds: queuePriorityResolvedIdsRef.current,
        })
      }
      return buildFreestyleQueue(feedCards, config, {
        resolvedQuestionIds: queuePriorityResolvedIdsRef.current,
      })
    },
    [config, feedCards, mode, progress.activeQueueIds, queuePriorityResolvedIdsRef, todayConfig, todaySources],
  )
  const queueSignature = useMemo(() => buildQueueSignature(queue), [queue])
  const trainingCards = useMemo(() => queue.map((card) => ({
    id: card.id,
    quizQuestionId: isQuizCard(card) ? card.question.id : null,
  })), [queue])
  const resolvedQuestionIds = useMemo(
    () => new Set(Object.entries(progress.questionStates)
      .filter(([, state]) => state.resolved === true)
      .map(([questionId]) => Number(questionId))),
    [progress.questionStates],
  )
  const canCompleteRound = domainCanCompleteRound(trainingCards, {
    currentIndex: progress.currentIndex,
    resolvedQuestionIds,
  })
  const [trainingActor] = useState(() => createActor(freestyleTrainingMachine).start())
  const trainingSnapshot = useSyncExternalStore(
    (listener) => {
      const subscription = trainingActor.subscribe(listener)
      return () => subscription.unsubscribe()
    },
    () => trainingActor.getSnapshot(),
    () => trainingActor.getSnapshot(),
  )

  useEffect(() => {
    return () => {
      trainingActor.stop()
    }
  }, [trainingActor])

  useEffect(() => {
    trainingActor.send({
      type: 'ROUND_SYNCED',
      cards: trainingCards,
      currentIndex: progress.currentIndex,
      resolvedQuestionIds: [...resolvedQuestionIds],
    })
    if (
      mode === 'today' &&
      progress.currentIndex >= queue.length &&
      domainCanCompleteRound(trainingCards, { currentIndex: progress.currentIndex, resolvedQuestionIds })
    ) {
      trainingActor.send({ type: 'ROUND_COMPLETE_REQUESTED' })
    }
  }, [mode, progress.currentIndex, queue.length, resolvedQuestionIds, trainingActor, trainingCards])

  const summaryVisible = mode === 'today' && trainingSnapshot.matches('completed')
  const currentIndex = summaryVisible
    ? queue.length
    : clampTrainingIndex(trainingCards, {
      currentIndex: progress.currentIndex,
      resolvedQuestionIds,
    })
  const currentCard = queue[currentIndex] ?? null

  const setConfigAndPersist = useCallback((updater: (current: FreestyleConfig) => FreestyleConfig) => {
    setConfig((current) => saveFreestyleConfig(updater(current)))
  }, [setConfig])

  const setTodayConfigAndPersist = useCallback((updater: (current: TodayTrainingConfig) => TodayTrainingConfig) => {
    setTodayConfig((current) => saveTodayTrainingConfig(updater(current)))
  }, [setTodayConfig])

  useEffect(() => {
    if (feedLoading) return
    if (queue.length === 0 && !feedError) return
    setProgressAndPersist((current) => {
      const maxIndex = mode === 'today' && canCompleteRound
        ? queue.length
        : Math.max(0, queue.length - 1)
      const nextIndex = Math.min(current.currentIndex, maxIndex)
      const nextActiveQueueIds =
        mode === 'today' && current.activeQueueIds.length === 0
          ? queue.map((card) => card.id)
          : current.activeQueueIds
      const nextQueueSignature =
        current.lastQueueSignature === queueSignature
          ? current.lastQueueSignature
          : queueSignature
      if (
        current.currentIndex === nextIndex &&
        current.lastQueueSignature === nextQueueSignature &&
        stringListsEqual(current.activeQueueIds, nextActiveQueueIds)
      ) {
        return current
      }
      return {
        ...current,
        currentIndex: nextIndex,
        activeQueueIds: nextActiveQueueIds,
        lastQueueSignature: nextQueueSignature,
      }
    })
  }, [canCompleteRound, feedError, feedLoading, mode, queue, queue.length, queueSignature, setProgressAndPersist])

  const handleReshuffle = useCallback(() => {
    queuePriorityResolvedIdsRef.current = progress.resolvedQuestionIds
    setFeedError('')
    setFeedLoading(true)
    if (mode === 'today') {
      setTodayConfigAndPersist((current) => ({
        ...current,
        seed: nextTodayTrainingSeed(current.seed),
      }))
    } else {
      setConfigAndPersist((current) => ({
        ...current,
        seed: nextFreestyleSeed(current.seed),
      }))
    }
    const nextProgress = {
      ...progress,
      currentIndex: 0,
      activeQueueIds: [],
      lastQueueSignature: '',
    }
    setProgressAndPersist(() => nextProgress)
    resetRuntimeRefs(nextProgress)
  }, [
    mode,
    progress,
    queuePriorityResolvedIdsRef,
    resetRuntimeRefs,
    setConfigAndPersist,
    setFeedError,
    setFeedLoading,
    setProgressAndPersist,
    setTodayConfigAndPersist,
  ])

  const switchMode = useCallback((nextMode: FreestyleMode) => {
    if (nextMode === mode) return
    setMode(nextMode)
    const nextProgress = nextMode === 'today' ? readTodayTrainingProgress() : readFreestyleProgress()
    setProgress(nextProgress)
    resetRuntimeRefs(nextProgress)
    setFeedError('')
    setFeedLoading(true)
  }, [mode, resetRuntimeRefs, setFeedError, setFeedLoading, setMode, setProgress])

  const todaySummary = useMemo(
    () => buildTodayTrainingSummary(queue, progress, timer.effectiveSeconds),
    [progress, queue, timer.effectiveSeconds],
  )

  return {
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
  }
}
