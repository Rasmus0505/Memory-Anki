import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitQuizResultFeedback } from './quizResultFeedback'

const mocks = vi.hoisted(() => ({
  dispatchGlobalFeedback: vi.fn(),
}))

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: (...args: unknown[]) => mocks.dispatchGlobalFeedback(...args),
}))

describe('emitQuizResultFeedback', () => {
  beforeEach(() => {
    mocks.dispatchGlobalFeedback.mockReset()
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('emits correct feedback with a restrained affirmative haptic cue', () => {
    emitQuizResultFeedback({ correct: true })

    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledWith('quiz_result_correct', {
      audioScope: 'local',
    })
    expect(navigator.vibrate).toHaveBeenCalledWith(18)
  })

  it('emits incorrect feedback without punitive vibration or celebration', () => {
    emitQuizResultFeedback({ correct: false })

    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledWith('quiz_result_incorrect', {
      audioScope: 'local',
    })
    expect(navigator.vibrate).not.toHaveBeenCalled()
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
