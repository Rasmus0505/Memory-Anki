import { useEffect, useState } from 'react'
import { listQuestionNodeBindingsApi } from '@/modules/quiz/domain/quiz-entity/api'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import {
  collectMemoryLookupFocusNodeUids,
  pickMemoryLookupBinding,
  resolveMemoryLookupPalaceId,
} from '@/widgets/palace-memory-lookup'

/** Resolves which palace / nodes the 查看宫殿 lookup should focus for the current question. */
export function useQuestionLookupFocus(current: PalaceQuizQuestion | null, palaceLookupOpen: boolean) {
  const [lookupFocusNodeUids, setLookupFocusNodeUids] = useState<string[]>([])
  const [lookupPalaceIdOverride, setLookupPalaceIdOverride] = useState<number | null>(null)

  useEffect(() => {
    if (!palaceLookupOpen || !current) {
      if (!palaceLookupOpen) {
        setLookupFocusNodeUids([])
        setLookupPalaceIdOverride(null)
      }
      return
    }
    const fallbackPalaceId = current.palace_id ?? null
    let cancelled = false
    void listQuestionNodeBindingsApi(current.id)
      .then((response) => {
        if (cancelled) return
        const items = response.items || []
        const binding = pickMemoryLookupBinding(items, fallbackPalaceId)
        setLookupFocusNodeUids(collectMemoryLookupFocusNodeUids(items, fallbackPalaceId))
        setLookupPalaceIdOverride(resolveMemoryLookupPalaceId(binding, fallbackPalaceId))
      })
      .catch(() => {
        if (cancelled) return
        setLookupFocusNodeUids([])
        setLookupPalaceIdOverride(fallbackPalaceId)
      })
    return () => {
      cancelled = true
    }
  }, [current, palaceLookupOpen])

  return { lookupFocusNodeUids, lookupPalaceIdOverride }
}
