import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { useAiRunConfigDialog } from '@/modules/settings/public'
import { createFreestyleQuestionAttemptApi } from '@/modules/practice/ui/freestyle/api'
import { buildAttemptHistoryPayload } from '@/modules/practice/ui/freestyle/model/freestyle-attempts'
import { isQuizCard } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  DEFAULT_FREESTYLE_PROGRESS,
  readFreestyleProgress,
  saveFreestyleProgress,
  type FreestyleProgressSnapshot,
} from '@/modules/practice/ui/freestyle/model/freestyle'
import {
  readTodayTrainingProgress,
  saveTodayTrainingProgress,
  type FreestyleMode,
} from '@/modules/practice/ui/freestyle/model/today-training'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { useQuizAttemptOrchestration } from '@/modules/quiz/public'
import { emitQuizResultFeedback } from '@/modules/quiz/public'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'
import { emitReviewConfetti } from '@/shared/components/celebration'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { toast } from '@/shared/feedback/toast'
import type { useTimedSession } from '@/shared/hooks/useTimedSession'

type FreestyleTimer = ReturnType<typeof useTimedSession>
type PromptForAiOptions = ReturnType<typeof useAiRunConfigDialog>['promptForAiOptions']

export function useFreestyleQuizFlow({
  mode,
  queueRef,
  timer,
  reducedMotion,
  promptForAiOptions,
  updateFeedQuestion,
}: {
  mode: FreestyleMode
  queueRef: MutableRefObject<FreestyleCard[]>
  timer: FreestyleTimer
  reducedMotion: boolean
  promptForAiOptions: PromptForAiOptions
  updateFeedQuestion: (question: FreestyleQuizCard['question']) => void
}) {
  const [progress, setProgress] = useState<FreestyleProgressSnapshot>(() =>
    mode === 'today' ? readTodayTrainingProgress() : readFreestyleProgress(),
  )
  const previousResolvedQuestionIdsRef = useRef<Set<number>>(
    new Set(progress.resolvedQuestionIds),
  )
  const queuePriorityResolvedIdsRef = useRef<number[]>(progress.resolvedQuestionIds)
  const emittedMilestonesRef = useRef<Set<number>>(new Set())

  const setProgressAndPersist = useCallback(
    (updater: (current: FreestyleProgressSnapshot) => FreestyleProgressSnapshot) => {
      setProgress((current) => {
        const next = updater(current)
        if (next === current) return current
        return mode === 'today'
          ? saveTodayTrainingProgress(next)
          : saveFreestyleProgress(next)
      })
    },
    [mode],
  )

  const resetRuntimeRefs = useCallback((nextProgress: FreestyleProgressSnapshot) => {
    previousResolvedQuestionIdsRef.current = new Set(nextProgress.resolvedQuestionIds)
    queuePriorityResolvedIdsRef.current = nextProgress.resolvedQuestionIds
    emittedMilestonesRef.current = new Set()
  }, [])

  const updateQuestionState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      setProgressAndPersist((current) => {
        const previous = current.questionStates[questionId] || {}
        const nextState = updater(previous)
        const wasResolved = Boolean(previous.resolved)
        const isResolved = Boolean(nextState.resolved)
        const resolvedIds = new Set(current.resolvedQuestionIds)
        let nextStreak = current.correctStreak
        if (!wasResolved && isResolved) {
          resolvedIds.add(questionId)
          if (typeof nextState.correct === 'boolean') {
            nextStreak = nextState.correct ? current.correctStreak + 1 : 0
          }
        }
        return {
          ...current,
          correctStreak: nextStreak,
          resolvedQuestionIds: Array.from(resolvedIds),
          questionStates: {
            ...current.questionStates,
            [questionId]: nextState,
          },
        }
      })
    },
    [setProgressAndPersist],
  )

  const orchestration = useQuizAttemptOrchestration({
    adapter: {
      readQuestionState: (questionId) => progress.questionStates[questionId] || {},
      updateQuestionState,
      applyUpdatedQuestion: updateFeedQuestion,
    },
    promptForAiOptions,
    shortAnswerEntrypointKey: 'freestyle-short-answer-feedback',
    resultFeedbackMode: 'external',
    emitFeedback: dispatchGlobalFeedback,
    onChoiceStart: () => {
      timer.registerActivity('practice_interaction', { source: 'freestyle_choice' })
    },
  })

  const handleChoiceResolve = useCallback(
    (card: FreestyleQuizCard, optionId: string, isCorrect: boolean) => {
      orchestration.handleChoiceSelect(card.question, optionId, isCorrect)
    },
    [orchestration],
  )

  const handleShortAnswerSubmit = useCallback(
    (card: FreestyleQuizCard) => {
      orchestration.handleShortAnswerSubmit(card.question.id)
    },
    [orchestration],
  )

  const handleShortAnswerFeedback = useCallback(
    async (card: FreestyleQuizCard) => {
      await orchestration.handleShortAnswerFeedback(card.question)
    },
    [orchestration],
  )

  const handleClearLocalProgress = useCallback(async () => {
    const confirmed = await appConfirm(
      mode === 'today'
        ? '确定清空今日训练本地进度吗？此操作不可撤销，会重置已做题目、连对记录和当前位置。'
        : '确定清空随心练习本地进度吗？此操作不可撤销，会重置已做题目、连对记录和当前位置。',
      {
        title: '清空本地进度',
        confirmText: '清空进度',
        tone: 'danger',
      },
    )
    if (!confirmed) return
    const nextProgress =
      mode === 'today'
        ? saveTodayTrainingProgress(DEFAULT_FREESTYLE_PROGRESS)
        : saveFreestyleProgress(DEFAULT_FREESTYLE_PROGRESS)
    previousResolvedQuestionIdsRef.current = new Set(nextProgress.resolvedQuestionIds)
    emittedMilestonesRef.current = new Set()
    setProgress(nextProgress)
  }, [mode])

  useEffect(() => {
    const previousResolvedIds = previousResolvedQuestionIdsRef.current
    const nextResolvedIds = new Set(progress.resolvedQuestionIds)
    const newlyResolvedIds = progress.resolvedQuestionIds.filter((id) => !previousResolvedIds.has(id))
    previousResolvedQuestionIdsRef.current = nextResolvedIds

    if (newlyResolvedIds.length === 0) return

    newlyResolvedIds.forEach((questionId) => {
      const state = progress.questionStates[questionId]
      if (!state?.resolved) return
      const card = queueRef.current.find((item): item is FreestyleQuizCard => isQuizCard(item) && item.question.id === questionId)
      if (card) {
        void createFreestyleQuestionAttemptApi(buildAttemptHistoryPayload(card, state, mode))
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : '随心做题记录保存失败。')
          })
      }
      if (typeof state.correct === 'boolean') {
        emitQuizResultFeedback({ correct: state.correct, reducedMotion })
      } else if (state.shortAnswerSubmitted) {
        dispatchGlobalFeedback('quiz_answer_submit', { label: '提交答案', audioScope: 'local' })
      }
    })

    const latestResolvedId = newlyResolvedIds.at(-1)
    const latestState = latestResolvedId ? progress.questionStates[latestResolvedId] : null
    if (!latestState?.correct) return

    const feedbackSettings = readReviewFeedbackSettings()
    const milestoneSteps = feedbackSettings.scenes.milestone.steps
    const currentStreak = progress.correctStreak
    if (!milestoneSteps.includes(currentStreak) || emittedMilestonesRef.current.has(currentStreak)) {
      return
    }
    emittedMilestonesRef.current.add(currentStreak)
    if (
      feedbackSettings.mode !== 'immersive' ||
      feedbackSettings.milestoneEffectsEnabled === false ||
      !feedbackSettings.scenes.milestone.enabled
    ) {
      return
    }
    emitReviewConfetti({
      kind: 'milestone',
      confettiAmount: feedbackSettings.scenes.milestone.confettiAmount,
      confettiPreset: feedbackSettings.scenes.milestone.confettiPreset,
      milestoneStep: milestoneSteps.indexOf(currentStreak),
      reducedMotion:
        reducedMotion ||
        feedbackSettings.reducedCelebrationMotion ||
        !feedbackSettings.animationEnabled ||
        !feedbackSettings.scenes.milestone.animationEnabled,
      soundEnabled:
        feedbackSettings.soundEnabled && feedbackSettings.scenes.milestone.soundEnabled,
      volume: getSceneEffectiveVolume(feedbackSettings, 'milestone'),
    })
  }, [
    progress.correctStreak,
    progress.questionStates,
    progress.resolvedQuestionIds,
    mode,
    queueRef,
    reducedMotion,
  ])

  const answeredQuestionIds = useMemo(
    () => new Set(progress.resolvedQuestionIds),
    [progress.resolvedQuestionIds],
  )

  return {
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
  }
}
