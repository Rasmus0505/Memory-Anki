import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import { readFreestyleCombo } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { cue, useFxOwner } from '@/shared/fx'

/**
 * Unit-complete ceremony for one card encounter. Individual cracks fly to their
 * parent on the map; this cue only fires when the unit's own count fills, and
 * it must never send that energy into the rating rail.
 */
export function useFreestyleCardParticles(args: {
  sectionRef: RefObject<HTMLElement | null>
  active: boolean
  /** Changes with card and encounter, so a stale flip can never complete another unit. */
  progressKey: string
  revealed: number | null
  total: number | null
}) {
  const { sectionRef, active, progressKey, revealed, total } = args
  const owner = useFxOwner(active ? `card:${progressKey}` : null)
  const ownerRef = useRef(owner)
  ownerRef.current = owner

  const lastProgressRef = useRef<{ key: string; revealed: number } | null>(null)
  useEffect(() => {
    if (revealed == null || total == null) return
    const previous = lastProgressRef.current
    lastProgressRef.current = { key: progressKey, revealed }
    const completedNow = previous?.key === progressKey && previous.revealed < total && revealed >= total && total > 0
    const section = sectionRef.current
    if (!completedNow || !owner || !section) return
    cue('unit.complete', { scope: section, combo: readFreestyleCombo().combo }, { owner })
  }, [owner, progressKey, revealed, sectionRef, total])

  /** Undo: the landed particles fly back out of the rail into the keycap that is being un-pressed. */
  const playUndo = useCallback((rating: UnitRating | null | undefined) => {
    const button = rating == null ? null : sectionRef.current?.querySelector(`[data-testid="freestyle-rating-button-${rating}"]`)
    if (button) cue('grade.undo', { button }, { owner: ownerRef.current })
  }, [sectionRef])

  const playRemove = useCallback(() => {
    const rect = sectionRef.current?.getBoundingClientRect()
    if (rect && rect.width > 0) cue('card.remove', { rect })
  }, [sectionRef])

  return { playUndo, playRemove }
}
