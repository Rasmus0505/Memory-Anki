import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playFeedbackAudio, triggerCelebration } from '@/shared/feedback/feedbackCenter'

const mocks = vi.hoisted(() => ({
  launchCelebrationPreset: vi.fn(),
  playWebAudioComboMilestone: vi.fn(),
  playWebAudioFeedbackEvent: vi.fn(),
  playWebAudioFireworkAccent: vi.fn(),
}))

vi.mock('@/shared/feedback/celebrationEngine', () => ({
  launchCelebrationPreset: (...args: unknown[]) => mocks.launchCelebrationPreset(...args),
}))

vi.mock('@/shared/components/mindmap-host/webAudioFeedback', () => ({
  playWebAudioComboMilestone: (...args: unknown[]) => mocks.playWebAudioComboMilestone(...args),
  playWebAudioFeedbackEvent: (...args: unknown[]) => mocks.playWebAudioFeedbackEvent(...args),
  playWebAudioFireworkAccent: (...args: unknown[]) => mocks.playWebAudioFireworkAccent(...args),
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
    mocks.playWebAudioComboMilestone.mockReset()
    mocks.playWebAudioFeedbackEvent.mockReset()
    mocks.playWebAudioFireworkAccent.mockReset()
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

    expect(mocks.playWebAudioFeedbackEvent).toHaveBeenCalledTimes(3)
    expect(mocks.playWebAudioFeedbackEvent).toHaveBeenNthCalledWith(1, {
      event: 'quiz_result_correct',
      audioScope: 'local',
      origin: 'review',
      surprise: undefined,
      volume: 1,
    })
    expect(mocks.playWebAudioFeedbackEvent).toHaveBeenNthCalledWith(2, {
      event: 'quiz_result_incorrect',
      audioScope: 'local',
      origin: 'review',
      surprise: undefined,
      volume: 1,
    })
    expect(mocks.playWebAudioFeedbackEvent).toHaveBeenNthCalledWith(3, {
      event: 'quiz_answer_submit',
      audioScope: 'local',
      origin: 'review',
      surprise: undefined,
      volume: 1,
    })
  })

  it('plays review milestone audio in the default immersive sound path', () => {
    playFeedbackAudio({ milestoneStep: 8 })

    expect(mocks.playWebAudioComboMilestone).toHaveBeenCalledWith({
      milestoneStep: 8,
      volume: 1,
    })
  })

  it('plays celebration audio cues through the web audio firework accent path', () => {
    triggerCelebration({
      preset: 'fireworks',
      reducedMotion: false,
      audioCue: {
        kind: 'session_complete',
        milestoneStep: null,
      },
    })

    expect(mocks.playWebAudioFireworkAccent).toHaveBeenCalledWith({
      kind: 'session_complete',
      milestoneStep: 0,
      volume: 1,
    })
  })
})
