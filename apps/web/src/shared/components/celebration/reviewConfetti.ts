import {
  notifyFeedback,
  type FeedbackScenario,
} from '@/shared/feedback/feedbackCenter'
import type { CelebrationPreset } from '@/shared/feedback/celebrationEngine'

type ReviewConfettiKind = 'milestone' | 'branch_clear' | 'all_clear_ready' | 'session_complete'

/**
 * 各事件未显式指定烟花类型时的兜底预设。
 * 强度完全由预设本身决定（庆典 > 爆发 > 星爆 > 写实 > 庆祝），
 * 不再有按 cinematic/confettiAmount 升档的逻辑。
 */
const DEFAULT_KIND_PRESET: Record<ReviewConfettiKind, CelebrationPreset> = {
  milestone: 'fireworks',
  branch_clear: 'fireworks',
  all_clear_ready: 'stars',
  session_complete: 'school_pride',
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
  milestoneStep?: number | null
  soundEnabled?: boolean
  volume?: number
  /**
   * 烟花类型（庆祝 / 爆发 / 写实 / 星爆 / 庆典）。
   * 缺省时按事件 kind 兜底。
   */
  confettiPreset?: CelebrationPreset
}) {
  const {
    kind,
    reducedMotion,
    milestoneStep = null,
    soundEnabled = false,
    volume = 1,
    confettiPreset,
  } = args

  const preset = confettiPreset ?? DEFAULT_KIND_PRESET[kind]

  notifyFeedback({
    scenario: resolveScenario(kind),
    celebration: {
      preset,
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
