import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'
import { notifyFeedback } from '@/shared/feedback/feedbackCenter'
import type {
  FeedbackPreset,
  ReviewFeedbackSceneSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

type TimerCelebrationKind = 'secondary' | 'primary'

/**
 * Escalating visuals for repeated completions, chosen by the one feedback
 * preset. Timer celebration used to have its own three-level "intensity"
 * setting that duplicated this concept in a second place.
 */
function resolveTimerCelebrationPreset(
  kind: TimerCelebrationKind,
  preset: FeedbackPreset,
  completionCount: number,
): CelebrationPreset {
  if (kind === 'primary') {
    if (preset === 'focus') return 'stars'
    if (preset === 'balanced') return 'school_pride'
    return completionCount >= 6 ? 'school_pride' : 'fireworks'
  }

  if (preset === 'focus') return 'realistic_look'
  if (preset === 'balanced') return completionCount >= 6 ? 'fireworks' : 'realistic_look'
  if (completionCount >= 10) return 'school_pride'
  if (completionCount >= 6) return 'fireworks'
  return 'stars'
}

export function emitTimerCelebration(args: {
  completionCount: number
  kind: TimerCelebrationKind
  reducedMotion: boolean
  soundEnabled: boolean
  /** Already includes the scene's volume boost (see getSceneEffectiveVolume). */
  volume: number
  preset: FeedbackPreset
  scene: ReviewFeedbackSceneSettings
}) {
  const { completionCount, kind, reducedMotion, soundEnabled, volume, preset, scene } = args

  notifyFeedback({
    scenario: kind === 'primary' ? 'timer_primary_complete' : 'timer_secondary_complete',
    celebration: scene.enabled
      ? {
          preset:
            scene.confettiPreset ?? resolveTimerCelebrationPreset(kind, preset, completionCount),
          reducedMotion,
          animationEnabled: scene.animationEnabled,
          soundEnabled: scene.soundEnabled && soundEnabled,
          volume,
          audioCue: {
            kind: kind === 'primary' ? 'session_complete' : 'milestone',
            milestoneStep: Math.max(0, Math.min(4, completionCount - 1)),
          },
        }
      : false,
    soundEnabled: scene.enabled && scene.soundEnabled && soundEnabled,
  })
}
