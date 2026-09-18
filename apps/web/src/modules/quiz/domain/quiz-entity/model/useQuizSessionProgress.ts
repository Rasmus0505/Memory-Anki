import { useCallback, useEffect, useState } from 'react'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'
import {
  markQuizSessionCompleted,
  readQuizSessionCompletedIds,
  readQuizSessionStates,
  removeQuizSessionQuestions,
  resetQuizSessionQuestion,
  subscribeQuizSessionProgress,
  writeQuizSessionState,
} from '@/modules/quiz/domain/quiz-entity/model/quizSessionProgress'

export function useQuizSessionProgress() {
  const [, setTick] = useState(0)

  useEffect(() => {
    return subscribeQuizSessionProgress(() => setTick((value) => value + 1))
  }, [])

  const updateQuestionState = useCallback(
    (
      questionId: number,
      updater: (current: QuizRuntimeState) => QuizRuntimeState,
      palaceId?: number | null,
    ) => {
      const next = updater(readQuizSessionStates()[questionId] ?? {})
      writeQuizSessionState(questionId, next, palaceId)
    },
    [],
  )

  return {
    questionStates: readQuizSessionStates(),
    completedQuestionIds: readQuizSessionCompletedIds(),
    updateQuestionState,
    markQuestionCompleted: markQuizSessionCompleted,
    resetQuestionState: resetQuizSessionQuestion,
    removeQuestionStates: removeQuizSessionQuestions,
  }
}
