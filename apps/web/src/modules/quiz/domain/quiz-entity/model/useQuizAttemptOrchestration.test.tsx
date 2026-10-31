import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { useQuizAttemptOrchestration } from './useQuizAttemptOrchestration'

type AttemptResponse = { question: PalaceQuizQuestion; auto_marked?: boolean }

const calls: string[] = []
let settleAttempt: ((value: AttemptResponse) => void) | null = null

vi.mock('@/modules/quiz/domain/quiz-entity/api', () => ({
  recordPalaceQuizChoiceAttemptApi: () => {
    calls.push('attempt:request')
    return new Promise<AttemptResponse>((resolve) => {
      settleAttempt = resolve
    })
  },
  requestPalaceShortAnswerFeedbackApi: () => Promise.resolve({}),
}))

vi.mock('@/modules/quiz/domain/quiz-entity/model/quizResultFeedback', () => ({
  emitQuizResultFeedback: () => {
    calls.push('result:sound')
  },
}))

vi.mock('@/modules/quiz/domain/quiz-entity/model/quizMutationFeedback', () => ({
  showQuizMutationMarkedToast: () => {
    calls.push('toast:auto-marked')
  },
}))

const question = {
  id: 7,
  palace_id: 1,
  question_type: 'multiple_choice',
  stem: '题干',
  options: [
    { id: 'A', text: 'A' },
    { id: 'B', text: 'B' },
  ],
  answer_payload: { correct_option_id: 'B' },
  analysis: '',
  sort_order: 1,
  correct_count: 0,
  incorrect_count: 0,
  attempt_count: 0,
} as unknown as PalaceQuizQuestion

function setup(resultFeedbackMode: 'immediate' | 'external' = 'immediate') {
  const adapter = {
    readQuestionState: () => ({}),
    updateQuestionState: vi.fn(),
    applyUpdatedQuestion: vi.fn(),
  }
  const emitFeedback = vi.fn((event: string) => {
    calls.push(`feedback:${event}`)
  })
  const hook = renderHook(() =>
    useQuizAttemptOrchestration({
      adapter,
      promptForAiOptions: vi.fn(),
      shortAnswerEntrypointKey: 'test',
      resultFeedbackMode,
      emitFeedback,
    }),
  )
  return { ...hook, adapter, emitFeedback }
}

describe('useQuizAttemptOrchestration result feedback', () => {
  beforeEach(() => {
    calls.length = 0
    settleAttempt = null
  })

  /**
   * The cue belongs to the tap. It used to run in the attempt POST's `.then()`,
   * so a contended database or a queued write delivered「答对」a beat late — often
   * once the next question was already on screen.
   */
  it('plays the answer cue before the attempt write settles', async () => {
    const { result, adapter } = setup()

    act(() => {
      result.current.handleChoiceSelect(question, 'B')
    })

    expect(adapter.applyUpdatedQuestion).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['result:sound', 'feedback:quiz_result_reveal', 'attempt:request'])

    await act(async () => {
      settleAttempt?.({ question: { ...question, correct_count: 1 } })
    })

    // The write settling must not replay the cue.
    expect(calls.filter((call) => call === 'result:sound')).toHaveLength(1)
    expect(adapter.applyUpdatedQuestion).toHaveBeenCalledTimes(2)
  })

  it('stays silent when another surface owns the cue', async () => {
    const { result } = setup('external')

    act(() => {
      result.current.handleChoiceSelect(question, 'A')
    })

    expect(calls).toEqual(['attempt:request'])
  })

  it('still surfaces the auto-mark toast from the attempt response', async () => {
    const { result } = setup()

    act(() => {
      result.current.handleChoiceSelect(question, 'A')
    })
    await act(async () => {
      settleAttempt?.({ question, auto_marked: true })
    })

    expect(calls).toContain('toast:auto-marked')
  })
})
