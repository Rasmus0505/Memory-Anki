import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import { useFreestyleQuizFlow } from './useFreestyleQuizFlow'

const mocks = vi.hoisted(() => ({
  emitQuizResultFeedback: vi.fn(),
  dispatchGlobalFeedback: vi.fn(),
  writeQuizSessionState: vi.fn(),
  removeQuizSessionQuestions: vi.fn(),
  showQuizMutationMarkedToast: vi.fn(),
  createAttempt: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  createFreestyleQuestionAttemptApi: mocks.createAttempt,
}))

vi.mock('@/modules/quiz/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/quiz/public')>()
  return {
    ...actual,
    useQuizAttemptOrchestration: () => ({
      handleChoiceSelect: vi.fn(),
      handleShortAnswerSubmit: vi.fn(),
      handleShortAnswerFeedback: vi.fn(),
    }),
    writeQuizSessionState: mocks.writeQuizSessionState,
    removeQuizSessionQuestions: mocks.removeQuizSessionQuestions,
    emitQuizResultFeedback: mocks.emitQuizResultFeedback,
    showQuizMutationMarkedToast: mocks.showQuizMutationMarkedToast,
  }
})

vi.mock('@/shared/feedback/globalFeedbackModel', () => ({
  dispatchGlobalFeedback: mocks.dispatchGlobalFeedback,
}))

vi.mock('@/shared/feedback/reviewFeedbackSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/feedback/reviewFeedbackSettings')>()
  return {
    ...actual,
    // No milestone steps, so the streak celebration never fires in these cases.
    readReviewFeedbackSettings: () => ({
      ...actual.DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      scenes: {
        ...actual.DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes,
        milestone: {
          ...actual.DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.milestone,
          steps: [],
          enabled: false,
        },
      },
    }),
  }
})

vi.mock('@/shared/components/celebration', () => ({ emitReviewCelebration: vi.fn() }))
vi.mock('@/shared/components/ui/native-dialog', () => ({ appConfirm: vi.fn() }))
vi.mock('@/shared/feedback/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

function mountFlow() {
  const queueRef = { current: [] as FreestyleCard[] }
  return renderHook(() =>
    useFreestyleQuizFlow({
      mode: 'free',
      queueRef,
      reducedMotion: false,
      promptForAiOptions: vi.fn(),
      updateFeedQuestion: vi.fn(),
      freshAttemptStates: true,
    }),
  )
}

function answerChoice(flow: ReturnType<typeof mountFlow>, questionId: number, correct: boolean) {
  act(() => {
    flow.result.current.updateQuestionState(questionId, (state) => ({
      ...state,
      selectedOptionId: 'B',
      resolved: true,
      correct,
    }))
  })
}

describe('useFreestyleQuizFlow answer feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  /**
   * The cue must land with the tap. It used to be emitted from the effect that
   * watches progress, which only runs after the whole feed re-renders — quick
   * page turns left the sound and haptic behind the answer.
   */
  it('sounds the answer once, as soon as the question resolves', () => {
    const flow = mountFlow()

    answerChoice(flow, 11, true)

    expect(mocks.emitQuizResultFeedback).toHaveBeenCalledTimes(1)
    expect(mocks.emitQuizResultFeedback).toHaveBeenCalledWith({
      correct: true,
      reducedMotion: false,
    })
    // The shared mirror is written from the state this tap produced.
    expect(mocks.writeQuizSessionState).toHaveBeenCalledTimes(1)
    expect(mocks.writeQuizSessionState.mock.calls[0]?.[1]).toMatchObject({
      resolved: true,
      correct: true,
    })
  })

  it('does not sound again while editing an already answered question', () => {
    const flow = mountFlow()

    answerChoice(flow, 11, false)
    act(() => {
      flow.result.current.updateQuestionState(11, (state) => ({
        ...state,
        shortAnswerText: '补充想法',
      }))
    })

    expect(mocks.emitQuizResultFeedback).toHaveBeenCalledTimes(1)
    expect(mocks.emitQuizResultFeedback).toHaveBeenCalledWith({
      correct: false,
      reducedMotion: false,
    })
  })

  it('sounds a short-answer submit at the tap and lets a reset answer sound again', () => {
    const flow = mountFlow()

    act(() => {
      flow.result.current.updateQuestionState(12, (state) => ({
        ...state,
        resolved: true,
        shortAnswerSubmitted: true,
      }))
    })
    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledTimes(1)
    expect(mocks.dispatchGlobalFeedback.mock.calls[0]?.[0]).toBe('quiz_answer_submit')

    act(() => {
      flow.result.current.resetQuestionAnswer(12)
    })
    answerChoice(flow, 12, true)

    expect(mocks.emitQuizResultFeedback).toHaveBeenCalledTimes(1)
    expect(mocks.dispatchGlobalFeedback).toHaveBeenCalledTimes(1)
  })
})
