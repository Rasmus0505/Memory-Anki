import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitQuizResultFeedback } from './quizResultFeedback'

const mocks = vi.hoisted(() => ({
  dispatchGlobalFeedback: vi.fn(),
  emitReviewConfetti: vi.fn(),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: (...args: unknown[]) => mocks.dispatchGlobalFeedback(...args),
}))

vi.mock('@/shared/components/celebration', () => ({
  emitReviewConfetti: (...args: unknown[]) => mocks.emitReviewConfetti(...args),
}))

vi.mock('@/shared/feedback/reviewFeedbackSettings', () => ({
  getSceneEffectiveVolume: () => 1.2,
  readReviewFeedbackSettings: () => ({
    animationEnabled: true,
    mode: 'immersive',
    reducedCelebrationMotion: false,
    scenes: {
      quiz: {
        animationEnabled: true,
        confettiAmount: 0.8,
        confettiPreset: 'random_direction',
        enabled: true,
        soundEnabled: true,
      },
    },
    soundEnabled: true,
  }),
}))

describe('emitQuizResultFeedback', () => {
  beforeEach(() => {
    mocks.dispatchGlobalFeedback.mockReset()
    mocks.emitReviewConfetti.mockReset()
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('emits correct feedback with a short progressive haptic cue', () => {
    emitQuizResultFeedback({ correct: true })

    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledWith('quiz_result_correct', {
      label: '答对',
      screenPulse: 'soft',
      audioScope: 'local',
    })
    expect(navigator.vibrate).toHaveBeenCalledWith([30])
    expect(mocks.emitReviewConfetti).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'quiz_correct',
        soundEnabled: true,
        volume: 1.2,
      }),
    )
  })

  it('emits incorrect feedback with a double haptic cue and no confetti', () => {
    emitQuizResultFeedback({ correct: false })

    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledWith('quiz_result_incorrect', {
      label: '答错',
      screenPulse: null,
      audioScope: 'local',
    })
    expect(navigator.vibrate).toHaveBeenCalledWith([40, 60, 40])
    expect(mocks.emitReviewConfetti).not.toHaveBeenCalled()
  })

  it('treats haptics as optional for Safari engines without Vibration API support', () => {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: undefined,
    })

    expect(() => emitQuizResultFeedback({ correct: true })).not.toThrow()
    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledWith('quiz_result_correct', expect.any(Object))
  })
})
