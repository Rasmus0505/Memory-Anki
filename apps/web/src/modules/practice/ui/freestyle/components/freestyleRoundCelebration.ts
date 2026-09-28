import { useEffect, useRef, useState } from 'react'
import { emitReviewConfetti } from '@/shared/components/celebration'
import { triggerHaptic } from '@/shared/feedback/haptics'
import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
} from '@/shared/feedback/reviewFeedbackSettings'

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

// Fires the round-complete confetti + haptic once per round, honoring the completion scene.
export function useRoundCompleteCelebration(roundKey: string, reducedMotion: boolean) {
  const firedFor = useRef<string | null>(null)

  useEffect(() => {
    if (firedFor.current === roundKey) return
    const settings = readReviewFeedbackSettings()
    const scene = settings.scenes.completion
    if (!resolveFeedbackChannels(settings).completionEffects || !scene.enabled) return
    const quietMotion = reducedMotion
      || settings.reducedCelebrationMotion
      || !settings.animationEnabled
      || !scene.animationEnabled
    // Mark as fired inside the timer so a StrictMode effect replay still celebrates once.
    const timer = window.setTimeout(() => {
      firedFor.current = roundKey
      triggerHaptic('celebrate')
      emitReviewConfetti({
        kind: 'session_complete',
        confettiAmount: scene.confettiAmount,
        confettiPreset: scene.confettiPreset,
        reducedMotion: quietMotion,
        soundEnabled: settings.soundEnabled && scene.soundEnabled,
        volume: getSceneEffectiveVolume(settings, 'completion'),
      })
    }, quietMotion ? 0 : 280)
    return () => window.clearTimeout(timer)
  }, [reducedMotion, roundKey])
}
