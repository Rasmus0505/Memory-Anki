import { useCallback, useEffect, useState } from 'react'
import type { QuizAnswerMode } from '@/modules/quiz/domain/quiz-entity/model/quizAnswerMode'
import {
  QUIZ_ANSWER_MODE_UPDATED_EVENT,
  readQuizAnswerMode,
  saveQuizAnswerMode,
} from '@/modules/quiz/domain/quiz-entity/model/quizAnswerModeSettings'

export function useQuizAnswerMode() {
  const [mode, setMode] = useState<QuizAnswerMode>(() => readQuizAnswerMode())

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      const next =
        detail && typeof detail === 'object' && 'mcqMode' in detail
          ? detail.mcqMode === 'subjective'
            ? 'subjective'
            : 'choice'
          : readQuizAnswerMode()
      setMode(next)
    }
    window.addEventListener(QUIZ_ANSWER_MODE_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(QUIZ_ANSWER_MODE_UPDATED_EVENT, handleUpdate)
  }, [])

  const updateMode = useCallback((next: QuizAnswerMode) => {
    setMode(saveQuizAnswerMode(next).mcqMode)
  }, [])

  return { mode, updateMode }
}
