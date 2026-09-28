import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import { readFreestyleCombo } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { emitBadgeBurst, emitFlight } from '@/shared/feedback/particles'
import { MINDMAP_CARD_LANDED_EVENT } from '@/shared/ui/mindmap-canvas/useMindMapRevealMotion'
import {
  bumpElement,
  chargeSegment,
  elementPoint,
  flashElement,
  freestyleMotionOn,
  peelCard,
  playLandingChime,
  progressTargetPoint,
  viewingSegment,
} from './freestyleParticleScenes'

const FLIP_BADGE = '[data-testid="flip-progress-badge"]'
/** Bulk reveals land dozens of cards at once; relay at most one flight per window. */
const LAND_RELAY_GAP_MS = 60
const UNIT_DONE_COMET_DELAY_MS = 520

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
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    let lastRelayAt = 0
    const onLanded = (event: Event) => {
      if (!activeRef.current || !freestyleMotionOn()) return
      const now = performance.now()
      if (now - lastRelayAt < LAND_RELAY_GAP_MS) return
      lastRelayAt = now
      const card = event.target instanceof Element ? event.target : null
      const origin = elementPoint(card)
      const badge = section.querySelector(FLIP_BADGE)
      if (!origin || !badge) return
      emitFlight({ origin, target: () => elementPoint(badge), count: 5, onFirstArrive: () => bumpElement(badge) })
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
    if (!completedNow || !active || !freestyleMotionOn()) return
    const section = sectionRef.current
    const badge = section?.querySelector(FLIP_BADGE)
    const from = elementPoint(badge)
    if (!badge || !from) return
    bumpElement(badge, 1.35)
    emitBadgeBurst(from)
    const segment = viewingSegment()
    const timer = window.setTimeout(() => {
      const origin = elementPoint(badge)
      if (!origin || !activeRef.current) return
      const { combo } = readFreestyleCombo()
      emitFlight({
        origin,
        target: progressTargetPoint,
        count: 12,
        glow: true,
        comet: true,
        fountain: 10,
        onFirstArrive: () => {
          chargeSegment(segment, Math.max(4, combo))
          playLandingChime(combo + 2)
        },
      })
    }, UNIT_DONE_COMET_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [active, progressKey, revealed, sectionRef, total])

  /** Undo: the landed particles fly back out of the rail into the keycap that is being un-pressed. */
  const playUndo = useCallback((rating: UnitRating | null | undefined) => {
    if (rating == null || !freestyleMotionOn()) return
    const section = sectionRef.current
    const button = section?.querySelector(`[data-testid="freestyle-rating-button-${rating}"]`)
    const segment = viewingSegment()
    const origin = elementPoint(segment)
    if (!button || !origin) return
    flashElement(segment, 0.45)
    emitFlight({ origin, target: () => elementPoint(button), count: 6, onFirstArrive: () => bumpElement(button) })
  }, [sectionRef])

  const playRemove = useCallback(() => peelCard(sectionRef.current), [sectionRef])

  return { playUndo, playRemove }
}
