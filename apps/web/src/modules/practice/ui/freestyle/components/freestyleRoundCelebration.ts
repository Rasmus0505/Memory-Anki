import { useEffect, useRef, useState } from 'react'
import { emitFlight, emitMeteorShower } from '@/shared/feedback/particles'
import { elementPoint, flashElement, stampOn } from './freestyleParticleScenes'
import { playWebAudioFireworkAccent } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
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

// Fires the round-complete meteor shower + haptic + accent once per round, honoring the completion scene.
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
    const flourish: number[] = []
    // Mark as fired inside the timer so a StrictMode effect replay still celebrates once.
    const timer = window.setTimeout(() => {
      firedFor.current = roundKey
      triggerHaptic('celebrate')
      if (!quietMotion) {
        emitMeteorShower()
        flourish.push(window.setTimeout(playExamStream, 1600))
        flourish.push(window.setTimeout(() => stampOn(document.body, '本轮完成', 'screen'), 2300))
      }
      if (settings.soundEnabled && scene.soundEnabled) {
        playWebAudioFireworkAccent({ kind: 'session_complete', volume: getSceneEffectiveVolume(settings, 'completion') })
      }
    }, quietMotion ? 0 : 280)
    return () => {
      window.clearTimeout(timer)
      flourish.forEach((id) => window.clearTimeout(id))
    }
  }, [reducedMotion, roundKey])
}

/** Light streams from the screen center into the exam progress block, which flashes on arrival. */
function playExamStream() {
  const exam = document.querySelector('[data-testid="freestyle-round-exam-summary"]')
  if (!exam || typeof window === 'undefined') return
  emitFlight({
    origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.4 },
    target: () => elementPoint(exam),
    count: 14,
    glow: true,
    comet: true,
    fountain: 12,
    onFirstArrive: () => flashElement(exam, 1.5),
  })
}
