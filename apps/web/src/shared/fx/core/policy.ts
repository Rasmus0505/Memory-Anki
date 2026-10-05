import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
  type FeedbackSceneKey,
} from '@/shared/feedback/reviewFeedbackSettings'
import { prefersReducedParticleMotion } from '../particles/particleEngine'

/** Which settings scene a cue answers to. `ambient` follows only the global switches. */
export type FxScene = 'review' | 'milestone' | 'completion' | 'ambient'

export interface FxGate {
  motion: boolean
  sound: boolean
  haptic: boolean
  volume: number
  gameplayFx?: import('@/shared/feedback/reviewFeedbackSettings').GameplayFeedbackFxSettings
}

const CLOSED: FxGate = { motion: false, sound: false, haptic: false, volume: 0 }

/**
 * The one place that turns settings + OS reduced motion into per-channel switches.
 * Mirrors the rules the freestyle callers used to repeat inline, scene by scene.
 */
export function resolveFxGate(scene: FxScene): FxGate {
  if (typeof window === 'undefined') return CLOSED
  const settings = readReviewFeedbackSettings()
  const channels = resolveFeedbackChannels(settings)
  const osMotion = !prefersReducedParticleMotion()
  const baseMotion = osMotion && settings.animationEnabled
  const haptic = settings.hapticsEnabled && osMotion
  const volumeFor = (key: FeedbackSceneKey) => getSceneEffectiveVolume(settings, key)

  if (scene === 'ambient') {
    return { motion: baseMotion, sound: false, haptic: false, volume: 0 }
  }
  if (scene === 'review') {
    const review = settings.scenes.review
    return {
      motion: baseMotion && review.enabled && review.animationEnabled,
      sound: settings.soundEnabled && channels.learningSounds && review.enabled && review.soundEnabled,
      haptic: haptic && review.enabled,
      volume: volumeFor('review'),
      gameplayFx: settings.gameplayFx,
    }
  }
  if (scene === 'milestone') {
    const milestone = settings.scenes.milestone
    const on = channels.milestoneEffects && milestone.enabled
    return {
      motion: baseMotion && on && milestone.animationEnabled,
      sound: settings.soundEnabled && on && milestone.soundEnabled,
      haptic: haptic && on,
      volume: volumeFor('milestone'),
    }
  }
  const completion = settings.scenes.completion
  const on = channels.completionEffects && completion.enabled
  return {
    motion: baseMotion && on && completion.animationEnabled && !settings.reducedCelebrationMotion,
    sound: settings.soundEnabled && on && completion.soundEnabled,
    haptic: haptic && on,
    volume: volumeFor('completion'),
  }
}
