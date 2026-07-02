import { useEffect, useState } from 'react'
import type { BilinkItem } from '@/shared/api/contracts'
import { getBilinksApi } from '@/features/bilink/api'

export function useBilinks(palaceId: number | null) {
  const [items, setItems] = useState<BilinkItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (!palaceId) {
      setItems([])
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    void getBilinksApi(palaceId)
      .then((response) => {
        if (cancelled) return
        setItems(response.items)
      })
      .catch((nextError) => {
        if (cancelled) return
        setItems([])
        setError(nextError instanceof Error ? nextError.message : '加载链接失败。')
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
    items,
    loading,
    error,
    refresh: () => setRefreshVersion((value) => value + 1),
  }
}
