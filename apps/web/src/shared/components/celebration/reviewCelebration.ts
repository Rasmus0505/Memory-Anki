import { cue } from '@/shared/fx'
import {
  triggerCelebration,
  type CelebrationScenario,
} from '@/shared/feedback/feedbackCenter'

export type ReviewCelebrationKind =
  | 'milestone'
  | 'branch_clear'
  | 'all_clear_ready'
  | 'session_complete'
  | 'quiz_correct'

const SCENARIO_BY_KIND: Record<ReviewCelebrationKind, CelebrationScenario> = {
  milestone: 'milestone',
  branch_clear: 'review',
  all_clear_ready: 'completion',
  session_complete: 'completion',
  quiz_correct: 'quiz',
}

export function emitReviewCelebration(args: {
  kind: ReviewCelebrationKind
  reducedMotion: boolean
  milestoneStep?: number | null
  soundEnabled?: boolean
  volume?: number
}) {
  const { kind, reducedMotion, milestoneStep = null, soundEnabled = false, volume = 1 } = args

  if (kind === 'all_clear_ready' || kind === 'session_complete') {
    cue('round.complete', { quiet: reducedMotion })
    return
  }

  triggerCelebration({
    scenario: SCENARIO_BY_KIND[kind],
    soundEnabled,
    volume,
    audioCue: {
      kind: kind === 'quiz_correct' ? 'branch_clear' : kind,
      milestoneStep,
    },
  })
}
