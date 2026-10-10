import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExamOverview } from '@/shared/api/contracts'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'
import { getExamOverviewApi } from '../api/examApi'

/** A score in another window should show on subject progress without a refresh. */
const REVIEW_REFRESH_DEBOUNCE_MS = 400

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
    let timer = 0
    const stopReviews = onAppEvent(APP_EVENT_NAMES.reviewStateChanged, () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void reload(), REVIEW_REFRESH_DEBOUNCE_MS)
    })
    return () => {
      requestIdRef.current += 1
      window.clearTimeout(timer)
      stopReviews()
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [reload])

  return { data, error, reload, setData }
}
