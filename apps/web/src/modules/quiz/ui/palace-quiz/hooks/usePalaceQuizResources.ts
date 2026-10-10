import { useEffect, useState } from 'react'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { loadPalaceQuizPageData, loadPalaceQuizQuestions } from '@/modules/quiz/ui/palace-quiz/api'
import type { PalaceQuizPageMeta } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import { peekPalaceEditor, peekPalaceQuestions } from '@/shared/study-text/studyTextLibrary'

function preparedQuiz(palaceId: number | null) {
  if (palaceId == null) return null
  const editor = peekPalaceEditor(palaceId)
  const questions = peekPalaceQuestions(palaceId)
  if (!editor?.palace || questions == null) return null
  return {
    palace: editor.palace as PalaceQuizPageMeta,
    questions,
  }
}

export function usePalaceQuizResources(palaceId: number | null) {
  const prepared = preparedQuiz(palaceId)
  const [palace, setPalace] = useState<PalaceQuizPageMeta | null>(prepared?.palace ?? null)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>(prepared?.questions ?? [])
  const [loading, setLoading] = useState(palaceId != null && prepared == null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!palaceId) return
    const ready = preparedQuiz(palaceId)
    if (ready) {
      setPalace(ready.palace)
      setQuestions(ready.questions)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const result = await loadPalaceQuizPageData(palaceId)
        if (cancelled) return
        setPalace(result.palace as PalaceQuizPageMeta)
        setQuestions(result.questions)
      } catch (nextError) {
        if (cancelled) return
        setError(nextError instanceof Error ? nextError.message : '加载做题页失败。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [palaceId])

  const refreshQuestions = async () => {
    if (!palaceId) return
    setQuestions(await loadPalaceQuizQuestions(palaceId))
  }

  return {
    palace,
    questions,
    loading,
    error,
    setPalace,
    setQuestions,
    refreshQuestions,
  }
}
