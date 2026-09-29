import { useEffect, useRef, useState } from 'react'
import { cue, useFxOwner } from '@/shared/fx'

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

export function useCountUp(target: number, { durationMs = 900, delayMs = 0, disabled = false } = {}) {
  const [value, setValue] = useState(disabled ? target : 0)

  useEffect(() => {
    if (disabled || typeof window.requestAnimationFrame !== 'function' || target <= 0) {
      setValue(target)
      return
    }
    let frame = 0
    let start = 0
    const tick = (now: number) => {
      if (!start) start = now + delayMs
      const t = Math.min(1, Math.max(0, (now - start) / durationMs))
      setValue(Math.round(easeOutCubic(t) * target))
      if (t < 1) frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [delayMs, disabled, durationMs, target])

  return value
}

/** Fires the round-complete cue once per round; the recipe honors the completion scene. */
export function useRoundCompleteCelebration(roundKey: string, reducedMotion: boolean) {
  const firedFor = useRef<string | null>(null)
  const owner = useFxOwner(`round:${roundKey}`)

  useEffect(() => {
    if (firedFor.current === roundKey) return
    // Deferred so a StrictMode effect replay still celebrates exactly once.
    const timer = window.setTimeout(() => {
      firedFor.current = roundKey
      cue('round.complete', { quiet: reducedMotion }, { owner })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [owner, reducedMotion, roundKey])
}
