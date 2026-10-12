import { useCallback, useEffect, useRef, useState } from 'react'
import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import { getFreestyleOverviewApi } from '../api/freestyleApi'
import { localDateKey } from '../model/freestyleDayRecap'

export interface FreestyleOverviewState {
  overview: FreestyleOverviewResponse | null
  baseline: FreestyleOverviewResponse | null
  error: boolean
  loading: boolean
  reload: () => Promise<FreestyleOverviewResponse | null>
}

function clientTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * The first successful read per round is kept as `baseline`, so settlement can
 * show what changed since the round opened. The overview is always a fresh read.
 */
export function useFreestyleOverview(roundId: string | null): FreestyleOverviewState {
  const [overview, setOverview] = useState<FreestyleOverviewResponse | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const baselineRef = useRef<{ roundId: string; overview: FreestyleOverviewResponse } | null>(null)
  const roundRef = useRef(roundId)
  roundRef.current = roundId

  const reload = useCallback(async () => {
    const owner = roundRef.current
    setLoading(true)
    try {
      const next = await getFreestyleOverviewApi({
        date: localDateKey(new Date()),
        tz: clientTimeZone(),
        roundId: owner,
      })
      if (roundRef.current !== owner) return null
      if (owner && (!baselineRef.current || baselineRef.current.roundId !== owner)) {
        baselineRef.current = { roundId: owner, overview: next }
      }
      setOverview(next)
      setError(false)
      return next
    } catch {
      if (roundRef.current === owner) setError(true)
      return null
    } finally {
      if (roundRef.current === owner) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [roundId, reload])

  return {
    overview,
    baseline: baselineRef.current && baselineRef.current.roundId === roundId ? baselineRef.current.overview : null,
    error,
    loading,
    reload,
  }
}
