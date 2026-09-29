import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import { readFreestyleCombo } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { cue, elementCenter, useFxOwner } from '@/shared/fx'
import { MINDMAP_CARD_LANDED_EVENT } from '@/shared/ui/mindmap-canvas/useMindMapRevealMotion'

/** Bulk reveals land dozens of cards at once; relay at most one flight per window. */
const LAND_RELAY_GAP_MS = 60

/**
 * Two-stage flip relay for one unit card, owned by that card's identity:
 * every landed flip sends gold dust into the card's own x/y flip badge; the flip
 * that completes the unit sends one comet from the badge into the round rail.
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

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let lastRelayAt = 0
    const onLanded = (event: Event) => {
      if (!ownerRef.current) return
      const now = performance.now()
      if (now - lastRelayAt < LAND_RELAY_GAP_MS) return
      lastRelayAt = now
      const origin = elementCenter(event.target instanceof Element ? event.target : null)
      if (origin) cue('flip.land', { origin, scope: section }, { owner: ownerRef.current })
    }
    section.addEventListener(MINDMAP_CARD_LANDED_EVENT, onLanded)
    return () => section.removeEventListener(MINDMAP_CARD_LANDED_EVENT, onLanded)
  }, [sectionRef])

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
