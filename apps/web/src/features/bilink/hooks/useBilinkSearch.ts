import { useEffect, useState } from 'react'
import type { BilinkSearchResult } from '@/shared/api/contracts'
import { searchBilinkNodesApi } from '@/features/bilink/api'

export function useBilinkSearch(query: string, open: boolean, limit = 20) {
  const [results, setResults] = useState<BilinkSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }

    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchBilinkNodesApi(trimmed, limit)
        if (cancelled) return
        setResults(response.results)
      } catch (nextError) {
        if (cancelled) return
        setResults([])
        setError(nextError instanceof Error ? nextError.message : '搜索失败，请稍后重试。')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [limit, open, query])

  return {
    results,
    loading,
    error,
  }
}
