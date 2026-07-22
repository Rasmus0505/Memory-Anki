import { useEffect, useState } from 'react'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { loadPalaceQuizPageData, loadPalaceQuizQuestions } from '@/modules/quiz/ui/palace-quiz/api'
import type { PalaceQuizPageMeta } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'

export function usePalaceQuizResources(palaceId: number | null) {
  const [palace, setPalace] = useState<PalaceQuizPageMeta | null>(null)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!palaceId) return
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
