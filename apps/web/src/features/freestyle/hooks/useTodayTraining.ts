import {
  useCallback,
  useEffect,
  useMemo,
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
import { stringListsEqual } from '@/features/freestyle/model/freestyle-cards'
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
  const summaryVisible =
    mode === 'today' &&
    queue.length > 0 &&
    progress.currentIndex >= queue.length
  const currentIndex = summaryVisible
    ? queue.length
    : Math.min(progress.currentIndex, Math.max(0, queue.length - 1))
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
      const maxIndex = mode === 'today' ? queue.length : Math.max(0, queue.length - 1)
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
  }, [feedError, feedLoading, mode, queue, queue.length, queueSignature, setProgressAndPersist])

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
    currentIndex,
    currentCard,
    setConfigAndPersist,
    setTodayConfigAndPersist,
    handleReshuffle,
    switchMode,
    todaySummary,
  }
}
