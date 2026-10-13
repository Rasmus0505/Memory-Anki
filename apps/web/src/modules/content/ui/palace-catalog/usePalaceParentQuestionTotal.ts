import { useEffect, useState } from 'react'
import {
  getPalacesGroupedApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
} from '@/modules/content/domain/palace-entity/api'
import type { PalaceGroupedListResponse } from '@/shared/api/contracts'
import { shareInFlightRequest } from '@/shared/api/inFlightRequest'
import { onAppEvent } from '@/shared/events/appEvents'

/**
 * Palace id → question total of the chapter that holds it. A palace outside any chapter takes its subject's
 * total instead. This is the denominator the palace list already uses for each palace's bar.
 */
export function buildPalaceParentQuestionTotals(
  data: PalaceGroupedListResponse | null | undefined,
): ReadonlyMap<number, number> {
  const totals = new Map<number, number>()
  for (const subject of data?.subjects ?? []) {
    const subjectTotal = subject.question_total ?? null
    for (const group of subject.chapter_groups ?? []) {
      const total = group.question_total ?? subjectTotal
      if (total == null) continue
      for (const palace of group.palaces ?? []) totals.set(palace.id, total)
    }
    if (subjectTotal == null) continue
    for (const palace of subject.ungrouped_palaces ?? []) totals.set(palace.id, subjectTotal)
  }
  return totals
}

/**
 * One grouped-catalog read shared by every mounted node map. A feed mounts several cards at once, and each
 * would otherwise fire its own copy of the same request against the SQLite pool. The resolved map is kept
 * until the catalog is invalidated.
 */
let parentTotalsCache: Promise<ReadonlyMap<number, number>> | null = null

function loadParentTotals() {
  if (!parentTotalsCache) {
    parentTotalsCache = shareInFlightRequest('palace-parent-question-totals', () => getPalacesGroupedApi())
      .then(buildPalaceParentQuestionTotals)
      .catch((error: unknown) => {
        parentTotalsCache = null
        throw error
      })
  }
  return parentTotalsCache
}

/**
 * Chapter question total for one palace, read from the grouped catalog. Null while the catalog is loading or
 * when the palace is not listed; callers then keep their palace-wide denominator.
 */
export function usePalaceParentQuestionTotal(
  palaceId: number | null | undefined,
  enabled = true,
): number | null {
  const [totals, setTotals] = useState<ReadonlyMap<number, number>>(() => new Map())

  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = () => {
      loadParentTotals()
        .then((value) => {
          if (active) setTotals(value)
        })
        .catch(() => {
          // Keep the last known totals; the root badge falls back to the palace until the catalog answers.
        })
    }
    load()
    const unsubscribe = onAppEvent(PALACE_CATALOG_INVALIDATED_EVENT, () => {
      parentTotalsCache = null
      load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [enabled])

  if (palaceId == null) return null
  return totals.get(palaceId) ?? null
}
