import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playFeedbackAudio, triggerCelebration } from '@/shared/feedback/feedbackCenter'

const mocks = vi.hoisted(() => ({
  playWebAudioComboMilestone: vi.fn(),
  playWebAudioFeedbackEvent: vi.fn(),
  playWebAudioFireworkAccent: vi.fn(),
}))

vi.mock('@/shared/feedback/mindmap-audio/webAudioFeedback', () => ({
  playWebAudioComboMilestone: (...args: unknown[]) => mocks.playWebAudioComboMilestone(...args),
  playWebAudioFeedbackEvent: (...args: unknown[]) => mocks.playWebAudioFeedbackEvent(...args),
  playWebAudioFireworkAccent: (...args: unknown[]) => mocks.playWebAudioFireworkAccent(...args),
}))

vi.mock('@/shared/feedback/reviewFeedbackSettings', () => ({
  // Base volume max (2) x per-scene boost max (3).
  REVIEW_FEEDBACK_EFFECTIVE_VOLUME_MAX: 6,
  getReviewFeedbackEffectiveVolume: () => 1,
  readReviewFeedbackSettings: () => ({
    animationEnabled: true,
    soundEnabled: true,
    volume: 1,
  }),
  resolveFeedbackChannels: () => ({
    learningSounds: true,
    milestoneEffects: true,
    completionEffects: true,
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

describe('feedbackCenter celebration audio', () => {
  beforeEach(() => {
    mocks.playWebAudioComboMilestone.mockReset()
    mocks.playWebAudioFeedbackEvent.mockReset()
    mocks.playWebAudioFireworkAccent.mockReset()
  })

  it('plays the firework accent for an audio cue when sound is on', () => {
    triggerCelebration({
      scenario: 'completion',
      audioCue: { kind: 'session_complete', milestoneStep: null },
    })

    expect(mocks.playWebAudioFireworkAccent).toHaveBeenCalledWith({
      kind: 'session_complete',
      milestoneStep: 0,
      volume: 1,
    })
  })

  it('stays silent when sound is explicitly disabled', () => {
    triggerCelebration({
      scenario: 'milestone',
      soundEnabled: false,
      audioCue: { kind: 'milestone', milestoneStep: 2 },
    })

    expect(mocks.playWebAudioFireworkAccent).not.toHaveBeenCalled()
  })

  it('stays silent without an audio cue', () => {
    triggerCelebration({ scenario: 'review' })

    expect(mocks.playWebAudioFireworkAccent).not.toHaveBeenCalled()
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
})
