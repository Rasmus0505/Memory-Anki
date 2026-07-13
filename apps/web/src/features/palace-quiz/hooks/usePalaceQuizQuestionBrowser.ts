import { useEffect, useMemo, useState } from 'react'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import type { PalaceQuizScopeKey, PalaceQuizViewMode } from '@/features/palace-quiz/model/palaceQuizPage'
import { QUIZ_VIEW_MODE_STORAGE_KEY, readPersistedViewMode } from '@/features/palace-quiz/model/palaceQuizPage'

export function usePalaceQuizQuestionBrowser({
  questions,
  segmentIds,
}: {
  questions: PalaceQuizQuestion[]
  segmentIds: number[]
}) {
  const [viewMode, setViewMode] = useState<PalaceQuizViewMode>(readPersistedViewMode)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questionScope, setQuestionScope] = useState<PalaceQuizScopeKey>('all')

  const filteredQuestions = useMemo(() => {
    if (questionScope === 'palace') {
      return questions.filter((question) => !(question.segment_ids?.length))
    }
    if (questionScope.startsWith('segment:')) {
      const segmentId = Number(questionScope.slice(8))
      return questions.filter((question) => question.segment_ids?.includes(segmentId))
    }
    return questions
  }, [questionScope, questions])

  const visibleQuestionIds = useMemo(
    () => filteredQuestions.map((question) => question.id),
    [filteredQuestions],
  )
  const currentQuestion = filteredQuestions[currentQuestionIndex] || null
  const rootQuestionCount = useMemo(
    () => questions.filter((question) => !(question.segment_ids?.length)).length,
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
    const segmentId = Number(questionScope.slice(8))
    if (!segmentIds.includes(segmentId)) {
      setQuestionScope('all')
    }
  }, [segmentIds, questionScope])

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
