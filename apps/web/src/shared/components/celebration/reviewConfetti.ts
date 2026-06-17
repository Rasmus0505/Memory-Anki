import {
  notifyFeedback,
  type FeedbackScenario,
} from '@/shared/feedback/feedbackCenter'
import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'

type CriticalFxIntensity = 'full' | 'cinematic'
type ReviewConfettiKind = 'milestone' | 'branch_clear' | 'all_clear_ready' | 'session_complete'

function clampConfettiAmount(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.5, Math.min(3, value))
}

function boostPreset(
  preset: CelebrationPreset,
  steps: number,
) {
  const orderedPresets: CelebrationPreset[] = [
    'random_direction',
    'realistic_look',
    'fireworks',
    'stars',
    'school_pride',
  ]
  const startIndex = orderedPresets.indexOf(preset)
  const nextIndex = Math.max(0, Math.min(orderedPresets.length - 1, startIndex + steps))
  return orderedPresets[nextIndex] ?? preset
}

function resolveReviewCelebrationPreset(args: {
  kind: ReviewConfettiKind
  criticalFxIntensity: CriticalFxIntensity
  milestoneStep: number | null
  confettiAmount: number
}) {
  const { kind, criticalFxIntensity, milestoneStep, confettiAmount } = args
  const safeAmount = clampConfettiAmount(confettiAmount)

  let preset: CelebrationPreset
  if (kind === 'milestone') {
    preset = milestoneStep != null && milestoneStep >= 2 ? 'fireworks' : 'realistic_look'
  } else if (kind === 'branch_clear') {
    preset = 'fireworks'
  } else if (kind === 'all_clear_ready') {
    preset = 'stars'
  } else {
    preset = 'school_pride'
  }

  let boost = 0
  if (criticalFxIntensity === 'cinematic') boost += 1
  if (safeAmount >= 1.8) boost += 1
  if (safeAmount >= 2.4) boost += 1
  if (kind === 'session_complete') boost += 1
  return boostPreset(preset, boost)
}

function resolveScenario(kind: ReviewConfettiKind): FeedbackScenario {
  if (kind === 'milestone') return 'review_milestone'
  if (kind === 'branch_clear') return 'review_branch_clear'
  if (kind === 'all_clear_ready') return 'review_all_clear_ready'
  return 'review_complete'
}

export function emitReviewConfetti(args: {
  kind: ReviewConfettiKind
  reducedMotion: boolean
  criticalFxIntensity?: CriticalFxIntensity
  milestoneStep?: number | null
  soundEnabled?: boolean
  volume?: number
  confettiAmount?: number
}) {
  const {
    kind,
    reducedMotion,
    criticalFxIntensity = 'cinematic',
    milestoneStep = null,
    soundEnabled = false,
    volume = 1,
    confettiAmount = 1,
  } = args

  notifyFeedback({
    scenario: resolveScenario(kind),
    celebration: {
      preset: resolveReviewCelebrationPreset({
        kind,
        criticalFxIntensity,
        milestoneStep,
        confettiAmount,
      }),
      reducedMotion,
      soundEnabled,
      volume,
      audioCue: {
        kind,
        milestoneStep,
      },
    },
  })
}
