import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExamOverview } from '@/shared/api/contracts'
import { getExamOverviewApi } from '../api/examApi'

export function useExamOverview() {
  const [data, setData] = useState<ExamOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setError(null)
    try {
      const overview = await getExamOverviewApi()
      if (requestId !== requestIdRef.current) return
      setData(overview)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      setError(caught instanceof Error ? caught.message : '加载考试概览失败。')
    }
  }, [])

  useEffect(() => {
    void reload()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      requestIdRef.current += 1
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [reload])

  return { data, error, reload, setData }
}
