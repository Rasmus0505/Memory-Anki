import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'
import { notifyFeedback } from '@/shared/feedback/feedbackCenter'
import type { TimerFeedbackIntensity } from '@/shared/components/session/timer-focus-config'

type TimerCelebrationKind = 'secondary' | 'primary'

function resolveTimerCelebrationPreset(
  kind: TimerCelebrationKind,
  intensity: TimerFeedbackIntensity,
  completionCount: number,
): CelebrationPreset {
  if (kind === 'primary') {
    if (intensity === 'visual_only') return 'stars'
    if (intensity === 'strong') return 'school_pride'
    return completionCount >= 6 ? 'school_pride' : 'stars'
  }

  if (intensity === 'visual_only') return 'random_direction'
  if (intensity === 'strong') return completionCount >= 6 ? 'fireworks' : 'realistic_look'
  if (completionCount >= 10) return 'stars'
  if (completionCount >= 6) return 'fireworks'
  return 'realistic_look'
}

export function emitTimerCelebration(args: {
  completionCount: number
  kind: TimerCelebrationKind
  reducedMotion: boolean
  soundEnabled: boolean
  volume: number
  feedbackIntensity: TimerFeedbackIntensity
}) {
  const {
    completionCount,
    kind,
    reducedMotion,
    soundEnabled,
    volume,
    feedbackIntensity,
  } = args

  notifyFeedback({
    scenario: kind === 'primary' ? 'timer_primary_complete' : 'timer_secondary_complete',
    celebration: {
      preset: resolveTimerCelebrationPreset(kind, feedbackIntensity, completionCount),
      reducedMotion,
      soundEnabled: soundEnabled && feedbackIntensity !== 'visual_only',
      volume: feedbackIntensity === 'strong' ? volume * 0.92 : volume,
      audioCue: {
        kind: kind === 'primary' ? 'session_complete' : 'milestone',
        milestoneStep: Math.max(0, Math.min(4, completionCount - 1)),
      },
    },
  })
}
