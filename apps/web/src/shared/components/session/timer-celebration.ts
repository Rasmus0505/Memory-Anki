import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'
import { notifyFeedback } from '@/shared/feedback/feedbackCenter'
import type {
  TimerCelebrationEventConfig,
  TimerFeedbackIntensity,
} from '@/shared/components/session/timer-focus-config'

type TimerCelebrationKind = 'secondary' | 'primary'

function resolveTimerCelebrationPreset(
  kind: TimerCelebrationKind,
  intensity: TimerFeedbackIntensity,
  completionCount: number,
): CelebrationPreset {
  if (kind === 'primary') {
    if (intensity === 'balanced') return 'stars'
    if (intensity === 'celebration') return 'school_pride'
    return completionCount >= 6 ? 'school_pride' : 'fireworks'
  }

  if (intensity === 'balanced') return 'realistic_look'
  if (intensity === 'celebration') return completionCount >= 6 ? 'fireworks' : 'realistic_look'
  if (completionCount >= 10) return 'school_pride'
  if (completionCount >= 6) return 'fireworks'
  return 'stars'
}

function resolveConfiguredPreset(
  kind: TimerCelebrationKind,
  intensity: TimerFeedbackIntensity,
  completionCount: number,
  eventConfig: TimerCelebrationEventConfig,
) {
  if (eventConfig.visualPreset !== 'auto') {
    return eventConfig.visualPreset
  }
  return resolveTimerCelebrationPreset(kind, intensity, completionCount)
}

export function emitTimerCelebration(args: {
  completionCount: number
  kind: TimerCelebrationKind
  reducedMotion: boolean
  soundEnabled: boolean
  volume: number
  feedbackIntensity: TimerFeedbackIntensity
  eventConfig: TimerCelebrationEventConfig
}) {
  const {
    completionCount,
    kind,
    reducedMotion,
    soundEnabled,
    volume,
    feedbackIntensity,
    eventConfig,
  } = args

  notifyFeedback({
    scenario: kind === 'primary' ? 'timer_primary_complete' : 'timer_secondary_complete',
    celebration: eventConfig.enabled
      ? {
          preset: resolveConfiguredPreset(kind, feedbackIntensity, completionCount, eventConfig),
          reducedMotion,
          animationEnabled: eventConfig.animationEnabled,
          soundEnabled: eventConfig.soundEnabled && soundEnabled,
          volume: volume * eventConfig.volumeBoost,
          audioCue: {
            kind: kind === 'primary' ? 'session_complete' : 'milestone',
            milestoneStep: Math.max(0, Math.min(4, completionCount - 1)),
          },
        }
      : false,
    soundEnabled: eventConfig.enabled && eventConfig.soundEnabled && soundEnabled,
  })
}
