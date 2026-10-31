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
import { useQuizAttemptOrchestration, writeQuizSessionState } from '@/modules/quiz/public'
import { emitQuizResultFeedback, removeQuizSessionQuestions, showQuizMutationMarkedToast } from '@/modules/quiz/public'
import type { FreestyleCard, FreestyleQuizCard } from '@/shared/api/contracts'
import { emitReviewCelebration } from '@/shared/components/celebration'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
} from '@/shared/feedback/reviewFeedbackSettings'
import { toast } from '@/shared/feedback/toast'

type PromptForAiOptions = ReturnType<typeof useAiRunConfigDialog>['promptForAiOptions']

export function useFreestyleQuizFlow({
  mode,
  queueRef,
  reducedMotion,
  promptForAiOptions,
  updateFeedQuestion,
  getDurationMs,
  /**
   * Immersive freestyle: do not restore prior choice/short-answer runtime states.
   * Historical localStorage answers were locking options (unable to re-answer) while
   * still showing cards. Keep a separate historical set only for the「已做过」badge.
   */
  freshAttemptStates = false,
}: {
  mode: FreestyleMode
  queueRef: MutableRefObject<FreestyleCard[]>
  reducedMotion: boolean
  promptForAiOptions: PromptForAiOptions
  updateFeedQuestion: (question: FreestyleQuizCard['question']) => void
  getDurationMs?: (questionId: number) => number | null
  freshAttemptStates?: boolean
}) {
  const historicalAnsweredIdsRef = useRef<Set<number>>(new Set())
  const [progress, setProgress] = useState<FreestyleProgressSnapshot>(() => {
    const stored =
      mode === 'today' ? readTodayTrainingProgress() : readFreestyleProgress()
    if (!freshAttemptStates) return stored
    historicalAnsweredIdsRef.current = new Set(stored.resolvedQuestionIds)
    return {
      ...DEFAULT_FREESTYLE_PROGRESS,
      // Session-local streak; historical resolved ids are badge-only (ref above).
      correctStreak: 0,
      resolvedQuestionIds: [],
      questionStates: {},
    }
  })
  // Latest snapshot for handlers that must read the answer before React commits
  // it (the tap that resolves a question runs before the next render).
  const progressRef = useRef(progress)
  progressRef.current = progress
  /** Question ids whose result cue was already played when the answer was given. */
  const announcedResolveIdsRef = useRef<Set<number>>(new Set())
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
        if (mode === 'today') {
          return saveTodayTrainingProgress(next)
        }
        if (freshAttemptStates) {
          // Merge session answers into historical badge set; never re-lock options
          // by persisting resolved questionStates for immersive freestyle.
          const mergedIds = new Set(historicalAnsweredIdsRef.current)
          next.resolvedQuestionIds.forEach((id) => mergedIds.add(id))
          historicalAnsweredIdsRef.current = mergedIds
          saveFreestyleProgress({
            ...next,
            resolvedQuestionIds: Array.from(mergedIds),
            questionStates: {},
          })
          return next
        }
        return saveFreestyleProgress(next)
      })
    },
    [freshAttemptStates, mode],
  )

  const resetRuntimeRefs = useCallback((nextProgress: FreestyleProgressSnapshot) => {
    previousResolvedQuestionIdsRef.current = new Set(nextProgress.resolvedQuestionIds)
    queuePriorityResolvedIdsRef.current = nextProgress.resolvedQuestionIds
    emittedMilestonesRef.current = new Set()
    announcedResolveIdsRef.current = new Set()
  }, [])

  const updateQuestionState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      const previous = progressRef.current.questionStates[questionId] || {}
      const answeredState = updater(previous)
      // Sound and haptic are part of giving the answer, so they run here — on the
      // tap — instead of in the effect below. That effect can only run after the
      // whole feed re-renders, which made the cue lag behind a fast page turn.
      // Every question type funnels through this call, including keyboard submits.
      if (!previous.resolved && answeredState.resolved) {
        if (typeof answeredState.correct === 'boolean') {
          announcedResolveIdsRef.current.add(questionId)
          emitQuizResultFeedback({ correct: answeredState.correct, reducedMotion })
        } else if (answeredState.shortAnswerSubmitted) {
          announcedResolveIdsRef.current.add(questionId)
          dispatchGlobalFeedback('quiz_answer_submit', { label: '提交答案', audioScope: 'local' })
        }
      }
      progressRef.current = {
        ...progressRef.current,
        questionStates: {
          ...progressRef.current.questionStates,
          [questionId]: answeredState,
        },
      }
      setProgressAndPersist((current) => {
        const previousState = current.questionStates[questionId] || {}
        const nextState = updater(previousState)
        const wasResolved = Boolean(previousState.resolved)
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
      // Mirror the state we just produced. Reading it from the updater meant a
      // queued update (answering twice before React flushed) skipped the mirror
      // entirely, because React only runs the updater eagerly when it is alone.
      const palaceId = queueRef.current.find(
        (card) => isQuizCard(card) && card.question.id === questionId,
      )?.palace_context?.id
      writeQuizSessionState(questionId, answeredState, palaceId)
    },
    [queueRef, reducedMotion, setProgressAndPersist],
  )

  const resetQuestionAnswer = useCallback(
    (questionId: number) => {
      historicalAnsweredIdsRef.current.delete(questionId)
      announcedResolveIdsRef.current.delete(questionId)
      setProgressAndPersist((current) => {
        const hasState = current.questionStates[questionId] != null
        const isResolved = current.resolvedQuestionIds.includes(questionId)
        if (!hasState && !isResolved) return current
        const questionStates = { ...current.questionStates }
        delete questionStates[questionId]
        return {
          ...current,
          correctStreak: 0,
          resolvedQuestionIds: current.resolvedQuestionIds.filter(
            (id) => id !== questionId,
          ),
          questionStates,
        }
      })
      removeQuizSessionQuestions([questionId])
    },
    [setProgressAndPersist],
  )

  const orchestration = useQuizAttemptOrchestration({
    adapter: {
      // Read through the ref: the tap's own state change is applied before the
      // next render, and a second attempt in the same tick must see it.
      readQuestionState: (questionId) => progressRef.current.questionStates[questionId] || {},
      updateQuestionState,
      applyUpdatedQuestion: updateFeedQuestion,
    },
    promptForAiOptions,
    shortAnswerEntrypointKey: 'freestyle-short-answer-feedback',
    resultFeedbackMode: 'external',
    emitFeedback: dispatchGlobalFeedback,
    getDurationMs,
    // The history record below owns the muscle-memory counters; counting the
    // choice attempt too would double one user answer.
    updateMutationStats: false,
    // The history record applies the authoritative question after its own
    // write; a choice response here could still be one transaction behind.
    applyQuestionUpdates: false,
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
    if (freshAttemptStates) {
      historicalAnsweredIdsRef.current = new Set()
    }
    announcedResolveIdsRef.current = new Set()
    const nextProgress =
      mode === 'today'
        ? saveTodayTrainingProgress(DEFAULT_FREESTYLE_PROGRESS)
        : saveFreestyleProgress(DEFAULT_FREESTYLE_PROGRESS)
    previousResolvedQuestionIdsRef.current = new Set(nextProgress.resolvedQuestionIds)
    emittedMilestonesRef.current = new Set()
    setProgress(
      freshAttemptStates
        ? {
            ...DEFAULT_FREESTYLE_PROGRESS,
            correctStreak: 0,
            resolvedQuestionIds: [],
            questionStates: {},
          }
        : nextProgress,
    )
  }, [freshAttemptStates, mode])

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
        void createFreestyleQuestionAttemptApi(
          buildAttemptHistoryPayload(
            card,
            state,
            mode,
            getDurationMs?.(questionId) ?? null,
          ),
        )
          .then((response) => {
            const item = response?.item
            if (item?.question) updateFeedQuestion(item.question)
            if (item?.auto_marked) {
              showQuizMutationMarkedToast(item.auto_mark_threshold_ms)
            }
          })
          .catch((error) => {
            toast.error(error instanceof Error ? error.message : '随心做题记录保存失败。')
          })
      }
      // Answers already sounded at the tap (see updateQuestionState). Only a
      // resolution this hook did not witness — a queued update landing late —
      // still needs its cue here.
      if (announcedResolveIdsRef.current.delete(questionId)) return
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
      !resolveFeedbackChannels(feedbackSettings).milestoneEffects ||
      !feedbackSettings.scenes.milestone.enabled
    ) {
      return
    }
    emitReviewCelebration({
      kind: 'milestone',
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
    getDurationMs,
    updateFeedQuestion,
  ])

  const answeredQuestionIds = useMemo(() => {
    if (!freshAttemptStates) {
      return new Set(progress.resolvedQuestionIds)
    }
    const merged = new Set(historicalAnsweredIdsRef.current)
    progress.resolvedQuestionIds.forEach((id) => merged.add(id))
    return merged
  }, [freshAttemptStates, progress.resolvedQuestionIds])

  return {
    progress,
    setProgress,
    setProgressAndPersist,
    updateQuestionState,
    resetQuestionAnswer,
    handleChoiceResolve,
    handleShortAnswerSubmit,
    handleClearLocalProgress,
    answeredQuestionIds,
    queuePriorityResolvedIdsRef,
    resetRuntimeRefs,
  }
}
