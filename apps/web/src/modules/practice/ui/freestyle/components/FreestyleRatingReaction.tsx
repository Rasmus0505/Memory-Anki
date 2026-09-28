import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import type { FlowRatingReaction } from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'
import { useFreestyleRatingPulse } from '@/modules/practice/ui/freestyle/model/freestyleComboStore'

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
const OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'

const FLASH_TONE: Record<UnitRating, string> = {
  1: 'var(--color-rate-again)',
  2: 'var(--color-rate-hard)',
  3: 'var(--color-rate-good)',
  4: 'var(--color-rate-easy)',
}

const SPARK_COUNT = 10

interface ActiveReaction {
  nonce: number
  rating: UnitRating
  reaction: FlowRatingReaction
}

function canAnimate(element: Element | null): element is HTMLElement {
  return !!element && typeof (element as HTMLElement).animate === 'function'
}

function Sparks({ tone }: { tone: string }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const animations: Animation[] = []
    root.querySelectorAll<HTMLElement>('[data-spark]').forEach((spark, index) => {
      if (!canAnimate(spark)) return
      const angle = (index / SPARK_COUNT) * Math.PI * 2 - Math.PI / 2
      const distance = 46 + (index % 3) * 18
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      animations.push(spark.animate(
        [
          { transform: 'translate3d(0,0,0) scale(0.4)', opacity: 1 },
          { transform: `translate3d(${x * 0.6}px,${y * 0.6}px,0) scale(1.3)`, opacity: 1, offset: 0.45 },
          { transform: `translate3d(${x}px,${y}px,0) scale(0)`, opacity: 0 },
        ],
        { duration: 600, easing: OUT_EXPO, fill: 'forwards' },
      ))
    })
    const plusOne = root.querySelector<HTMLElement>('[data-plus-one]')
    if (canAnimate(plusOne)) {
      animations.push(plusOne.animate(
        [
          { transform: 'translate3d(-50%,0,0) scale(0.6)', opacity: 0 },
          { transform: 'translate3d(-50%,-20px,0) scale(1.15)', opacity: 1, offset: 0.3 },
          { transform: 'translate3d(-50%,-40px,0) scale(1)', opacity: 1, offset: 0.7 },
          { transform: 'translate3d(-50%,-54px,0) scale(0.95)', opacity: 0 },
        ],
        { duration: 800, easing: OUT_EXPO, fill: 'forwards' },
      ))
    }
    return () => animations.forEach((animation) => animation.cancel())
  }, [])

  return (
    <div ref={rootRef} className="pointer-events-none absolute right-[18%] top-[38%] z-20" aria-hidden>
      {Array.from({ length: SPARK_COUNT }, (_, index) => (
        <span
          key={index}
          data-spark
          className="absolute block size-1.5 rounded-full opacity-0"
          style={{ background: index % 2 ? tone : 'var(--color-stage-glow)' }}
        />
      ))}
      <span
        data-plus-one
        className="absolute whitespace-nowrap text-lg font-black tracking-tight opacity-0"
        style={{ color: tone, textShadow: '0 2px 12px hsl(32 94% 60% / 0.55)' }}
      >
        +1
      </span>
    </div>
  )
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
      {shown?.reaction === 'fling' && tone ? <Sparks key={shown.nonce} tone={tone} /> : null}
    </div>
  )
}
