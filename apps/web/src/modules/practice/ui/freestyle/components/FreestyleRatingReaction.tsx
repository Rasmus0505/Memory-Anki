import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import type { FlowRatingReaction } from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'
import {
  readFreestyleCombo,
  useFreestyleRatingPulse,
} from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import {
  emitCollectors,
  emitComboMilestone,
  emitKeycapShockwave,
  emitRatingBurst,
  rectCenter,
} from '@/shared/feedback/particles'
import {
  chargeSegment,
  flashVignette,
  freestyleMotionOn,
  milestoneEffectsOn,
  playLandingChime,
  progressTargetPoint,
  stampOn,
  viewingSegment,
} from './freestyleParticleScenes'

// Web Animations API instead of `motion`: this wraps every card on the startup route.
// Every gesture returns to rest: rating never advances the card, so it must not leave.
const REACTION_KEYFRAMES: Record<FlowRatingReaction, { frames: Keyframe[]; duration: number }> = {
  sink: {
    frames: [
      { transform: 'translate3d(0,0,0) scale(1)' },
      { transform: 'translate3d(-6px,10px,0) scale(0.985)' },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ],
    duration: 380,
  },
  wobble: {
    frames: [
      { transform: 'translate3d(0,0,0)' },
      { transform: 'translate3d(-5px,0,0)' },
      { transform: 'translate3d(5px,0,0)' },
      { transform: 'translate3d(-3px,0,0)' },
      { transform: 'translate3d(2px,-4px,0)' },
      { transform: 'translate3d(0,0,0)' },
    ],
    duration: 400,
  },
  lift: {
    frames: [
      { transform: 'translate3d(0,0,0) scale(1)' },
      { transform: 'translate3d(0,-12px,0) scale(1.012)' },
      { transform: 'translate3d(0,0,0) scale(1)' },
    ],
    duration: 360,
  },
  fling: {
    frames: [
      { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
      { transform: 'translate3d(10px,-18px,0) rotate(1.2deg) scale(1.02)' },
      { transform: 'translate3d(0,0,0) rotate(0deg) scale(1)' },
    ],
    duration: 420,
  },
}

const REACTION_EASING = 'cubic-bezier(0.22, 1.2, 0.36, 1)'

const FLASH_TONE: Record<UnitRating, string> = {
  1: 'var(--color-rate-again)',
  2: 'var(--color-rate-hard)',
  3: 'var(--color-rate-good)',
  4: 'var(--color-rate-easy)',
}

interface ActiveReaction {
  nonce: number
  rating: UnitRating
  reaction: FlowRatingReaction
}

function canAnimate(element: Element | null): element is HTMLElement {
  return !!element && typeof (element as HTMLElement).animate === 'function'
}

/**
 * Burst and shockwave from the pressed keycap; collectors (comet-led for strong
 * grades) home onto the rail, charge the landing segment and chime on arrival.
 * Read before the card gesture moves the button.
 */
function playRatingParticles(scope: HTMLElement, rating: UnitRating) {
  if (!freestyleMotionOn()) return
  const button = scope.querySelector(`[data-testid="freestyle-rating-button-${rating}"]`)
  const rect = button?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  const origin = { x: rect.left + rect.width / 2, y: rect.top + 4 }
  const { combo, milestoneIndex } = readFreestyleCombo()
  emitRatingBurst(origin, rating, combo)
  emitKeycapShockwave(origin, rating)
  const segment = viewingSegment()
  emitCollectors({
    origin,
    rating,
    combo,
    target: progressTargetPoint,
    onFirstArrive: () => {
      chargeSegment(segment, rating >= 3 ? combo : 0)
      playLandingChime(combo)
    },
  })
  if (milestoneIndex != null && milestoneEffectsOn()) {
    emitComboMilestone(rectCenter(scope.getBoundingClientRect()), combo)
    stampOn(scope, `连击 ×${combo}`)
    flashVignette()
  }
}

function Flash({ reaction, tone }: { reaction: FlowRatingReaction; tone: string }) {
  const flashRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const flash = flashRef.current
    if (!canAnimate(flash)) return
    const peak = reaction === 'sink' ? 0.9 : 0.7
    const animation = flash.animate(
      [{ opacity: 0 }, { opacity: peak, offset: 0.35 }, { opacity: 0 }],
      { duration: 550, easing: 'ease-out', fill: 'forwards' },
    )
    return () => animation.cancel()
  }, [reaction])

  return (
    <div
      ref={flashRef}
      data-testid="freestyle-rating-reaction"
      data-reaction={reaction}
      className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] opacity-0"
      style={{ boxShadow: `inset 0 0 0 2px ${tone}, inset 0 0 80px -20px ${tone}` }}
      aria-hidden
    />
  )
}

/**
 * Plays the rating gesture on the card the learner is looking at. Owns its own
 * transform layer so it never fights the card-enter keyframes on the parent.
 */
export function FreestyleRatingReaction({ active, children }: { active: boolean; children: ReactNode }) {
  const pulse = useFreestyleRatingPulse()
  const seenNonceRef = useRef(pulse?.nonce ?? 0)
  const scopeRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<ActiveReaction | null>(null)

  useEffect(() => {
    if (!pulse || pulse.nonce === seenNonceRef.current) return
    seenNonceRef.current = pulse.nonce
    const scope = scopeRef.current
    if (!active || !scope) return
    playRatingParticles(scope, pulse.rating)
    const { frames, duration } = REACTION_KEYFRAMES[pulse.reaction]
    const animation = canAnimate(scope) ? scope.animate(frames, { duration, easing: REACTION_EASING }) : null
    setShown({ nonce: pulse.nonce, rating: pulse.rating, reaction: pulse.reaction })
    const timer = window.setTimeout(() => setShown(null), 820)
    return () => {
      window.clearTimeout(timer)
      animation?.cancel()
    }
  }, [active, pulse])

  const tone = shown ? FLASH_TONE[shown.rating] : undefined

  return (
    <div ref={scopeRef} className="relative flex min-h-0 flex-1 flex-col">
      {children}
      {shown && tone ? <Flash key={shown.nonce} reaction={shown.reaction} tone={tone} /> : null}
    </div>
  )
}
