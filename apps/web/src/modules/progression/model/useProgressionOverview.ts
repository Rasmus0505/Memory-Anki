import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProgressionOverview } from '@/shared/api/contracts'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'
import { getProgressionOverviewApi } from '../api/progressionApi'

/** Ratings arrive in bursts; one refetch per quiet window is plenty for a HUD. */
const REVIEW_REFRESH_DEBOUNCE_MS = 1600

export function useProgressionOverview({ followReviews = false }: { followReviews?: boolean } = {}) {
  const [data, setData] = useState<ProgressionOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const overview = await getProgressionOverviewApi()
      if (requestId !== requestIdRef.current) return null
      setData(overview)
      setError(null)
      return overview
    } catch (caught) {
      if (requestId !== requestIdRef.current) return null
      setError(caught instanceof Error ? caught.message : '加载成长数据失败。')
      return null
    }
  }, [])

  useEffect(() => {
    void reload()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    let timer = 0
    const stopReviews = followReviews
      ? onAppEvent(APP_EVENT_NAMES.reviewStateChanged, () => {
          window.clearTimeout(timer)
          timer = window.setTimeout(() => void reload(), REVIEW_REFRESH_DEBOUNCE_MS)
        })
      : () => undefined
    return () => {
      requestIdRef.current += 1
      window.clearTimeout(timer)
      stopReviews()
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [followReviews, reload])

  return { data, error, reload }
}
