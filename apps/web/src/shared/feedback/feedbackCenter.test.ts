import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playFeedbackAudio, triggerCelebration } from '@/shared/feedback/feedbackCenter'

const mocks = vi.hoisted(() => ({
  launchCelebrationPreset: vi.fn(),
  playLegacyComboMilestone: vi.fn(),
  playLegacyFeedbackEvent: vi.fn(),
  playLegacyFireworkAccent: vi.fn(),
}))

vi.mock('@/shared/feedback/celebrationEngine', () => ({
  launchCelebrationPreset: (...args: unknown[]) => mocks.launchCelebrationPreset(...args),
}))

vi.mock('@/shared/components/mindmap-host/legacyWebAudio', () => ({
  playLegacyComboMilestone: (...args: unknown[]) => mocks.playLegacyComboMilestone(...args),
  playLegacyFeedbackEvent: (...args: unknown[]) => mocks.playLegacyFeedbackEvent(...args),
  playLegacyFireworkAccent: (...args: unknown[]) => mocks.playLegacyFireworkAccent(...args),
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
    mocks.launchCelebrationPreset.mockReset()
    mocks.playLegacyComboMilestone.mockReset()
    mocks.playLegacyFeedbackEvent.mockReset()
    mocks.playLegacyFireworkAccent.mockReset()
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

    expect(mocks.launchCelebrationPreset).toHaveBeenCalledWith({
      preset: 'school_pride',
      reducedMotion: false,
      amount: 2.2,
      durationMs: 1800,
      scenario: 'timer',
    })
  })

  it('plays freestyle quiz feedback events in the default immersive sound path', () => {
    for (const event of ['quiz_result_correct', 'quiz_result_incorrect', 'quiz_answer_submit'] as const) {
      playFeedbackAudio({ event, audioScope: 'local', origin: 'review' })
    }

    expect(mocks.playLegacyFeedbackEvent).toHaveBeenCalledTimes(3)
    expect(mocks.playLegacyFeedbackEvent).toHaveBeenNthCalledWith(1, {
      event: 'quiz_result_correct',
      audioScope: 'local',
      origin: 'review',
      surprise: undefined,
      volume: 1,
    })
    expect(mocks.playLegacyFeedbackEvent).toHaveBeenNthCalledWith(2, {
      event: 'quiz_result_incorrect',
      audioScope: 'local',
      origin: 'review',
      surprise: undefined,
      volume: 1,
    })
    expect(mocks.playLegacyFeedbackEvent).toHaveBeenNthCalledWith(3, {
      event: 'quiz_answer_submit',
      audioScope: 'local',
      origin: 'review',
      surprise: undefined,
      volume: 1,
    })
  })

  it('plays review milestone audio in the default immersive sound path', () => {
    playFeedbackAudio({ milestoneStep: 8 })

    expect(mocks.playLegacyComboMilestone).toHaveBeenCalledWith({
      milestoneStep: 8,
      volume: 1,
    })
  })
})
