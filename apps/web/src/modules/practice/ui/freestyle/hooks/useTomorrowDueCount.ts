import { useEffect, useState } from 'react'
import { getFreestyleTomorrowDueApi } from '@/modules/practice/ui/freestyle/api'

/**
 * Units across the library due tomorrow, for the settlement status line.
 *
 * Returns null while loading or after a failed fetch, so the caller omits the
 * clause instead of showing a made-up number.
 */
export function useTomorrowDueCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setCount(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    void getFreestyleTomorrowDueApi({ signal: controller.signal })
      .then((response) => {
        if (!cancelled) setCount(response.due_tomorrow_count)
      })
      .catch(() => {
        if (!cancelled) setCount(null)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled])

  return count
}
