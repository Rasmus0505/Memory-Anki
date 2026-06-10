import { useEffect, useMemo, useState } from 'react'
import {
  buildMutationSummary,
  readQueuedMutations,
  replayQueuedMutations,
  subscribeMutationQueue,
  type PersistedMutation,
} from '@/shared/persistence/mutationQueue'

export function useMutationQueueState() {
  const [items, setItems] = useState<PersistedMutation[]>([])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const nextItems = await readQueuedMutations()
      if (!cancelled) {
        setItems(nextItems)
      }
    }
    void refresh()
    const unsubscribe = subscribeMutationQueue(() => {
      void refresh()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return {
    items,
    summary: useMemo(() => buildMutationSummary(items), [items]),
  }
}

export function useMutationQueueAutoSync() {
  useEffect(() => {
    const replay = () => {
      void replayQueuedMutations()
    }

    replay()
    const interval = window.setInterval(replay, 30_000)
    const handleOnline = () => replay()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        replay()
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
}

