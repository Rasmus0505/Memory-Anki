import { useEffect, useState } from 'react'
import { getBilinkCountsApi } from '@/features/bilink/api'

export function useBilinkCounts(palaceId: number | null) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (!palaceId) {
      setCounts({})
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    void getBilinkCountsApi(palaceId)
      .then((response) => {
        if (cancelled) return
        setCounts(response.counts)
      })
      .catch((nextError) => {
        if (cancelled) return
        setCounts({})
        setError(nextError instanceof Error ? nextError.message : '加载反链计数失败。')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [palaceId, refreshVersion])

  return {
    counts,
    loading,
    error,
    refresh: () => setRefreshVersion((value) => value + 1),
  }
}
