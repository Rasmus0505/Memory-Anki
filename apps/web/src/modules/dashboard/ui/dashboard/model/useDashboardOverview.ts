import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { getDashboardApi } from '@/modules/dashboard/ui/dashboard/api'

export function useDashboardOverview() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setError(null)
    setIsLoading(true)
    try {
      const dashboard = await getDashboardApi()
      if (requestIdRef.current !== requestId) return
      setData(dashboard)
    } catch (caughtError) {
      if (requestIdRef.current !== requestId) return
      setError(caughtError instanceof Error ? caughtError.message : '加载今日学习概览失败。')
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => {
      requestIdRef.current += 1
    }
  }, [reload])

  return { data, error, isLoading, reload }
}
