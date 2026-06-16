import { useEffect, useMemo, useState } from 'react'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import type { PalaceQuizScopeKey, PalaceQuizViewMode } from '@/features/palace-quiz/model/palaceQuizPage'
import { QUIZ_VIEW_MODE_STORAGE_KEY, readPersistedViewMode } from '@/features/palace-quiz/model/palaceQuizPage'

export function usePalaceQuizQuestionBrowser({
  questions,
  miniPalaceIds,
}: {
  questions: PalaceQuizQuestion[]
  miniPalaceIds: number[]
}) {
  const [viewMode, setViewMode] = useState<PalaceQuizViewMode>(readPersistedViewMode)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questionScope, setQuestionScope] = useState<PalaceQuizScopeKey>('all')

  const filteredQuestions = useMemo(() => {
    if (questionScope === 'palace') {
      return questions.filter((question) => question.mini_palace_id == null)
    }
    if (questionScope.startsWith('mini:')) {
      const miniPalaceId = Number(questionScope.slice(5))
      return questions.filter((question) => question.mini_palace_id === miniPalaceId)
    }
    return questions
  }, [questionScope, questions])

  const visibleQuestionIds = useMemo(
    () => filteredQuestions.map((question) => question.id),
    [filteredQuestions],
  )
  const currentQuestion = filteredQuestions[currentQuestionIndex] || null
  const rootQuestionCount = useMemo(
    () => questions.filter((question) => question.mini_palace_id == null).length,
    [questions],
  )

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(QUIZ_VIEW_MODE_STORAGE_KEY, viewMode)
    }
  }, [viewMode])

  useEffect(() => {
    setCurrentQuestionIndex((current) => {
      if (filteredQuestions.length === 0) return 0
      return Math.min(current, filteredQuestions.length - 1)
    })
  }, [filteredQuestions])

  useEffect(() => {
    if (questionScope === 'all' || questionScope === 'palace') return
    const miniPalaceId = Number(questionScope.slice(5))
    if (!miniPalaceIds.includes(miniPalaceId)) {
      setQuestionScope('all')
    }
  }, [miniPalaceIds, questionScope])

  return {
    viewMode,
    setViewMode,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    questionScope,
    setQuestionScope,
    filteredQuestions,
    visibleQuestionIds,
    currentQuestion,
    rootQuestionCount,
  }
}
