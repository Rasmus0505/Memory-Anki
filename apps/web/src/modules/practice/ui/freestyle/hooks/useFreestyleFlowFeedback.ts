import { useCallback, useEffect, useRef, useState } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import {
  FLOW_BREATH_MS,
  FLOW_PALACE_CLEARED_SIGNAL,
  FLOW_REVEAL_SIGNAL,
  flowRatingSignal,
  type FlowBreath,
  type FlowFeedbackSignal,
} from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import {
  useMindMapFeedbackAudio,
  useMindMapFeedbackSettings,
} from '@/shared/feedback/mindmap-audio/useMindMapFeedback'
import {
  getSceneEffectiveVolume,
  resolveFeedbackChannels,
} from '@/shared/feedback/reviewFeedbackSettings'

/**
 * Immediate confirmation for the two freestyle actions that had none.
 *
 * Reveals arrive as fast as the learner can click, so the tone is rate-limited: past
 * a certain speed a per-node sound stops being information and becomes texture. The
 * limit is deliberately short — it must never swallow a deliberate single flip.
 */
const REVEAL_AUDIO_MIN_GAP_MS = 90

export function useFreestyleFlowFeedback() {
  const settings = useMindMapFeedbackSettings()
  const reducedMotion = usePrefersReducedMotion()
  const { playEvent } = useMindMapFeedbackAudio(
    settings.soundEnabled,
    getSceneEffectiveVolume(settings, 'review'),
  )
  const [breath, setBreath] = useState<{ kind: Exclude<FlowBreath, null>; nonce: number } | null>(
    null,
  )
  const breathNonceRef = useRef(0)
  const breathTimerRef = useRef<number | null>(null)
  const lastRevealAudioAtRef = useRef(0)

  useEffect(() => {
    return () => {
      if (breathTimerRef.current != null) window.clearTimeout(breathTimerRef.current)
    }
  }, [])

  /**
   * Reveal tone rides the `review` scene, the same one formal review uses for its
   * per-reveal sound, so the 专注/平衡/激励 preset and the learning-sounds switch
   * already govern it. `focus` turns learning sounds off; that stays true here.
   */
  const signalReveal = useCallback(() => {
    if (!settings.soundEnabled) return
    if (!resolveFeedbackChannels(settings).learningSounds) return
    if (!settings.scenes.review.enabled || !settings.scenes.review.soundEnabled) return
    const now = Date.now()
    if (now - lastRevealAudioAtRef.current < REVEAL_AUDIO_MIN_GAP_MS) return
    lastRevealAudioAtRef.current = now
    playEvent(FLOW_REVEAL_SIGNAL.audioEvent, {
      origin: 'review',
      audioScope: 'local',
      volume: getSceneEffectiveVolume(settings, 'review'),
    })
  }, [playEvent, settings])

  /**
   * A rate is a deliberate, low-frequency act, so it is never rate-limited and it is
   * the one place a visual breath is worth its attention cost.
   */
  const playSignal = useCallback(
    (signal: FlowFeedbackSignal) => {
      if (
        settings.soundEnabled &&
        settings.scenes.review.enabled &&
        settings.scenes.review.soundEnabled &&
        resolveFeedbackChannels(settings).learningSounds
      ) {
        playEvent(signal.audioEvent, {
          origin: 'review',
          audioScope: 'local',
          volume: getSceneEffectiveVolume(settings, 'review'),
        })
      }

      if (!signal.breath) return
      if (!settings.animationEnabled || reducedMotion || settings.reducedCelebrationMotion) return
      breathNonceRef.current += 1
      setBreath({ kind: signal.breath, nonce: breathNonceRef.current })
      if (breathTimerRef.current != null) window.clearTimeout(breathTimerRef.current)
      breathTimerRef.current = window.setTimeout(() => {
        breathTimerRef.current = null
        setBreath(null)
      }, FLOW_BREATH_MS)
    },
    [playEvent, reducedMotion, settings],
  )

  const signalRating = useCallback(
    (rating: UnitRating, passed: boolean) => {
      playSignal(flowRatingSignal(rating, passed))
    },
    [playSignal],
  )

  const signalPalaceCleared = useCallback(() => {
    playSignal(FLOW_PALACE_CLEARED_SIGNAL)
  }, [playSignal])

  const clearBreath = useCallback(() => {
    if (breathTimerRef.current != null) {
      window.clearTimeout(breathTimerRef.current)
      breathTimerRef.current = null
    }
    setBreath(null)
  }, [])

  return { breath, signalReveal, signalRating, signalPalaceCleared, clearBreath }
}
