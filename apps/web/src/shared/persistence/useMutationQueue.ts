import { useEffect } from 'react'
import {
  replayQueuedMutations,
} from '@/shared/persistence/mutationQueue'

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
