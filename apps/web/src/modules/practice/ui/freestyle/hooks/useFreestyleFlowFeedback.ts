import { useCallback, useEffect, useRef, useState } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import {
  FLOW_BREATH_MS,
  FLOW_PALACE_CLEARED_SIGNAL,
  flowRatingSignal,
  type FlowBreath,
  type FlowFeedbackSignal,
} from '@/modules/practice/ui/freestyle/model/freestyleFlowFeedback'
import {
  publishFreestyleRatingPulse,
  recordFreestyleComboRating,
} from '@/modules/practice/ui/freestyle/model/freestyleComboStore'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import { triggerHaptic } from '@/shared/feedback/haptics'
import { playWebAudioPageTurn } from '@/shared/feedback/mindmap-audio/webAudioFeedback'
import {
  useMindMapFeedbackAudio,
  useMindMapFeedbackSettings,
} from '@/shared/feedback/mindmap-audio/useMindMapFeedback'
import {
  getSceneEffectiveVolume,
  resolveFeedbackChannels,
} from '@/shared/feedback/reviewFeedbackSettings'

/**
 * Reveals are counted, not sounded, here.
 *
 * The flip cascade already emits one layered pop per card through
 * `useMindMapRevealMotion`, so a tone from this hook would double it. What
 * remains is the haptic, which still fires per deliberate flip.
 */
const PAGE_TURN_AUDIO_MIN_GAP_MS = 110
const PAGE_TURN_HAPTIC_MIN_GAP_MS = 140
const PAGE_TURN_FULL_VOLUME_GAP_MS = 420

/** 0.45 at the fastest audible flick, rising to full volume for a deliberate turn. */
export function pageTurnAttenuation(gapMs: number) {
  const span = PAGE_TURN_FULL_VOLUME_GAP_MS - PAGE_TURN_AUDIO_MIN_GAP_MS
  const progress = Math.max(0, Math.min(1, (gapMs - PAGE_TURN_AUDIO_MIN_GAP_MS) / span))
  return 0.45 + 0.55 * progress
}

export function useFreestyleFlowFeedback() {
  const settings = useMindMapFeedbackSettings()
  const reducedMotion = usePrefersReducedMotion()
  const { playEvent, playComboMilestone } = useMindMapFeedbackAudio(
    settings.soundEnabled,
    getSceneEffectiveVolume(settings, 'review'),
  )
  const [breath, setBreath] = useState<{ kind: Exclude<FlowBreath, null>; nonce: number } | null>(
    null,
  )
  const breathNonceRef = useRef(0)
  const breathTimerRef = useRef<number | null>(null)
  const lastPageTurnAtRef = useRef(0)

  useEffect(() => {
    return () => {
      if (breathTimerRef.current != null) window.clearTimeout(breathTimerRef.current)
    }
  }, [])

  /**
   * Kept as a named action so call sites stay expressive, but it no longer plays a
   * tone: the reveal cascade owns that sound now (one pop per flipped card).
   */
  const signalReveal = useCallback(() => {
    triggerHaptic('tap')
  }, [])

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
      const signal = flowRatingSignal(rating, passed)
      playSignal(signal)
      triggerHaptic(signal.haptic)
      const milestoneScene = settings.scenes.milestone
      const combo = recordFreestyleComboRating(signal.keepsCombo, milestoneScene.steps)
      if (combo.milestoneIndex != null && milestoneScene.enabled) {
        triggerHaptic('milestone')
        if (settings.soundEnabled && milestoneScene.soundEnabled) {
          playComboMilestone(combo.milestoneIndex, {
            volume: getSceneEffectiveVolume(settings, 'milestone'),
          })
        }
      }
      if (settings.animationEnabled && !reducedMotion) {
        publishFreestyleRatingPulse(rating, signal.reaction)
      }
    },
    [playComboMilestone, playSignal, reducedMotion, settings],
  )

  const signalPalaceCleared = useCallback(() => {
    playSignal(FLOW_PALACE_CLEARED_SIGNAL)
  }, [playSignal])

  /** Every page turn sounds, but a fast flick-through thins out instead of clattering. */
  const signalPageTurn = useCallback(
    (direction: 'forward' | 'backward') => {
      const now = Date.now()
      const gap = now - lastPageTurnAtRef.current
      lastPageTurnAtRef.current = now
      if (gap > PAGE_TURN_HAPTIC_MIN_GAP_MS) triggerHaptic('tap')
      if (gap < PAGE_TURN_AUDIO_MIN_GAP_MS) return
      if (!settings.soundEnabled || !resolveFeedbackChannels(settings).learningSounds) return
      if (!settings.scenes.review.enabled || !settings.scenes.review.soundEnabled) return
      playWebAudioPageTurn({
        direction,
        volume: getSceneEffectiveVolume(settings, 'review') * pageTurnAttenuation(gap),
      })
    },
    [settings],
  )

  const clearBreath = useCallback(() => {
    if (breathTimerRef.current != null) {
      window.clearTimeout(breathTimerRef.current)
      breathTimerRef.current = null
    }
    setBreath(null)
  }, [])

  return { breath, signalReveal, signalRating, signalPalaceCleared, signalPageTurn, clearBreath }
}
