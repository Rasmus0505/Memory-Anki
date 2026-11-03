import { useCallback, useEffect, useState } from 'react'
import {
  sanitizeQuizOptionShuffleSettings,
  type QuizOptionShuffleSettings,
} from '@/modules/quiz/domain/quiz-entity/model/quizOptionShuffle'
import {
  QUIZ_OPTION_SHUFFLE_UPDATED_EVENT,
  readQuizOptionShuffleSettings,
  saveQuizOptionShuffleSettings,
} from '@/modules/quiz/domain/quiz-entity/model/quizOptionShuffleSettings'

export function useQuizOptionShuffleSettings() {
  const [settings, setSettings] = useState(readQuizOptionShuffleSettings)

  useEffect(() => {
    setSettings(readQuizOptionShuffleSettings())
    const update = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setSettings(sanitizeQuizOptionShuffleSettings(detail))
    }
    window.addEventListener(QUIZ_OPTION_SHUFFLE_UPDATED_EVENT, update)
    return () => window.removeEventListener(QUIZ_OPTION_SHUFFLE_UPDATED_EVENT, update)
  }, [])

  const updateSettings = useCallback((next: QuizOptionShuffleSettings) => {
    setSettings(saveQuizOptionShuffleSettings(next))
  }, [])

  return { settings, updateSettings }
}
