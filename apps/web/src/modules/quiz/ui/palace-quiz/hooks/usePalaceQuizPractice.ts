import { useQuizAttemptOrchestration, useQuizSessionProgress } from '@/modules/quiz/domain/quiz-entity'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity'
import type { AiRuntimeOptions, PalaceQuizQuestion } from '@/shared/api/contracts'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

export function usePalaceQuizPractice({
  palaceId,
  setQuestions,
  promptForAiOptions,
  registerQuizActivity,
  emitQuizFeedback,
}: {
  palaceId?: number | null
  setQuestions: React.Dispatch<React.SetStateAction<PalaceQuizQuestion[]>>
  promptForAiOptions: (options: {
    scenarioKey: string
    entrypointKey: string
    title: string
  }) => Promise<AiRuntimeOptions | null | undefined>
  registerQuizActivity: (source: string) => void
  emitQuizFeedback: (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => void
}) {
  const session = useQuizSessionProgress()

  const updateQuestionState = (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
  ) => {
    session.updateQuestionState(questionId, updater, palaceId)
  }

  const resetQuestionState = (questionId: number) => {
    session.resetQuestionState(questionId)
  }

  const removeQuestionStates = (questionIds: number[]) => {
    session.removeQuestionStates(questionIds)
  }

  const handleResetQuestionState = (questionId: number) => {
    registerQuizActivity('question_reset')
    emitQuizFeedback('quiz_answer_reset', { label: '重做', audioScope: 'local' })
    resetQuestionState(questionId)
  }

  const orchestration = useQuizAttemptOrchestration({
    adapter: {
      readQuestionState: (questionId) => session.questionStates[questionId] || {},
      updateQuestionState,
      applyUpdatedQuestion: (question) => {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? question : item)),
        )
      },
    },
    promptForAiOptions,
    shortAnswerEntrypointKey: 'quiz-short-answer-feedback',
    resultFeedbackMode: 'immediate',
    emitFeedback: emitQuizFeedback,
    emitChoiceStatErrorFeedback: true,
    onChoiceStart: ({ optionId }) => {
      registerQuizActivity('choice_select')
      emitQuizFeedback('quiz_answer_select', { label: optionId, audioScope: 'local' })
    },
  })

  const handleChoiceSelect = (question: PalaceQuizQuestion, optionId: string) => {
    orchestration.handleChoiceSelect(question, optionId)
  }

  const handleShortAnswerSubmit = (questionId: number) => {
    registerQuizActivity('short_answer_submit')
    emitQuizFeedback('quiz_answer_submit', { label: '提交答案', audioScope: 'local' })
    orchestration.handleShortAnswerSubmit(questionId)
  }

  const handleShortAnswerFeedback = async (question: PalaceQuizQuestion) => {
    registerQuizActivity('short_answer_feedback')
    await orchestration.handleShortAnswerFeedback(question)
  }

  const setQuestionStates = (
    next:
      | Record<number, QuizRuntimeState>
      | ((current: Record<number, QuizRuntimeState>) => Record<number, QuizRuntimeState>),
  ) => {
    const resolved = typeof next === 'function' ? next(session.questionStates) : next
    for (const [rawId, state] of Object.entries(resolved)) {
      const questionId = Number(rawId)
      if (!Number.isInteger(questionId) || questionId <= 0) continue
      session.updateQuestionState(questionId, () => state, palaceId)
    }
  }

  return {
    questionStates: session.questionStates,
    setQuestionStates,
    updateQuestionState,
    removeQuestionStates,
    handleResetQuestionState,
    handleChoiceSelect,
    handleShortAnswerSubmit,
    handleShortAnswerFeedback,
  }
}
