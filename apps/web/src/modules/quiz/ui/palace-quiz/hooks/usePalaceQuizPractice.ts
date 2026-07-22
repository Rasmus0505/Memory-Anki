import { useState } from 'react'
import { useQuizAttemptOrchestration } from '@/modules/quiz/domain/quiz-entity'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity'
import type { AiRuntimeOptions, PalaceQuizQuestion } from '@/shared/api/contracts'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

export function usePalaceQuizPractice({
  setQuestions,
  promptForAiOptions,
  registerQuizActivity,
  emitQuizFeedback,
}: {
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
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})

  const updateQuestionState = (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
  ) => {
    setQuestionStates((current) => ({
      ...current,
      [questionId]: updater(current[questionId] || {}),
    }))
  }

  const resetQuestionState = (questionId: number) => {
    setQuestionStates((current) => ({
      ...current,
      [questionId]: {
        resolved: false,
        correct: false,
        shortAnswerText: '',
        shortAnswerSubmitted: false,
        shortAnswerFeedback: null,
        shortAnswerFeedbackLoading: false,
        selectedOptionId: '',
        trueFalseAnswer: undefined,
        blankInputs: {},
        submittedBlankIds: [],
        matchingPairs: {},
        selectedLeftId: null,
        orderingIds: undefined,
        categorizationAssignments: {},
        selectedCategorizationItemId: null,
      },
    }))
  }

  const removeQuestionStates = (questionIds: number[]) => {
    const deletedIdSet = new Set(questionIds)
    setQuestionStates((current) => {
      const next = { ...current }
      deletedIdSet.forEach((questionId) => {
        delete next[questionId]
      })
      return next
    })
  }

  const handleResetQuestionState = (questionId: number) => {
    registerQuizActivity('question_reset')
    emitQuizFeedback('quiz_answer_reset', { label: '重做', audioScope: 'local' })
    resetQuestionState(questionId)
  }

  const orchestration = useQuizAttemptOrchestration({
    adapter: {
      readQuestionState: (questionId) => questionStates[questionId] || {},
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

  return {
    questionStates,
    setQuestionStates,
    updateQuestionState,
    removeQuestionStates,
    handleResetQuestionState,
    handleChoiceSelect,
    handleShortAnswerSubmit,
    handleShortAnswerFeedback,
  }
}
