import { beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerCelebration } from '@/shared/feedback/feedbackCenter'

const launchCelebrationPreset = vi.fn()

vi.mock('@/shared/feedback/celebrationEngine', () => ({
  launchCelebrationPreset: (...args: unknown[]) => launchCelebrationPreset(...args),
}))

vi.mock('@/shared/components/mindmap-host/legacyWebAudio', () => ({
  playLegacyComboMilestone: vi.fn(),
  playLegacyFeedbackEvent: vi.fn(),
  playLegacyFireworkAccent: vi.fn(),
}))

vi.mock('@/shared/feedback/reviewFeedbackSettings', () => ({
  REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX: 16,
  getReviewFeedbackEffectiveVolume: () => 1,
  readReviewFeedbackSettings: () => ({
    animationEnabled: true,
    mode: 'immersive',
    soundEnabled: true,
    volume: 1,
  }),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}))

describe('feedbackCenter celebration bridge', () => {
  beforeEach(() => {
    launchCelebrationPreset.mockReset()
  })

  it('passes confetti amount and scenario through to the celebration engine', () => {
    triggerCelebration({
      preset: 'school_pride',
      reducedMotion: false,
      amount: 2.2,
      durationMs: 1800,
      scenario: 'timer',
      soundEnabled: false,
    })

    expect(launchCelebrationPreset).toHaveBeenCalledWith({
      preset: 'school_pride',
      reducedMotion: false,
      amount: 2.2,
      durationMs: 1800,
      scenario: 'timer',
    })
  })
})
