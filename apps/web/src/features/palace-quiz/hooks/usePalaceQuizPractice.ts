import { useState } from 'react'
import { toast } from 'sonner'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { recordPalaceQuizChoiceAttemptApi, requestPalaceShortAnswerFeedbackApi } from '@/features/palace-quiz/api/palaceQuizApi'
import type { QuizRuntimeState } from '@/features/palace-quiz/QuizQuestionInteraction'

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
  }) => Promise<import('@/shared/api/contracts').AiRuntimeOptions | null | undefined>
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

  const handleChoiceSelect = (question: PalaceQuizQuestion, optionId: string) => {
    const currentState = questionStates[question.id]
    if (currentState?.resolved) return
    registerQuizActivity('choice_select')
    const isCorrect = question.answer_payload.correct_option_id === optionId
    emitQuizFeedback('quiz_answer_select', { label: optionId, audioScope: 'local' })
    void recordPalaceQuizChoiceAttemptApi(question.id, optionId)
      .then((response) => {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? response.question : item)),
        )
        emitQuizFeedback(isCorrect ? 'quiz_result_correct' : 'quiz_result_incorrect', {
          label: isCorrect ? '答对' : '答错',
          screenPulse: isCorrect ? 'soft' : null,
          audioScope: 'local',
        })
        emitQuizFeedback('quiz_result_reveal', {
          label: isCorrect ? '揭晓' : '答案',
          screenPulse: null,
          audioScope: 'local',
        })
      })
      .catch((nextError) => {
        emitQuizFeedback('quiz_error_stat_failed', { label: '统计失败', audioScope: 'local' })
        toast.error(nextError instanceof Error ? nextError.message : '统计刷新失败。')
      })
  }

  const handleShortAnswerSubmit = (questionId: number) => {
    registerQuizActivity('short_answer_submit')
    emitQuizFeedback('quiz_answer_submit', { label: '提交答案', audioScope: 'local' })
    updateQuestionState(questionId, (state) => ({
      ...state,
      resolved: true,
      shortAnswerSubmitted: true,
      shortAnswerFeedback: null,
    }))
  }

  const handleShortAnswerFeedback = async (question: PalaceQuizQuestion) => {
    registerQuizActivity('short_answer_feedback')
    const state = questionStates[question.id] || {}
    const userAnswer = state.shortAnswerText?.trim() || ''
    if (!userAnswer) {
      emitQuizFeedback('quiz_error_missing_input', { label: '先写答案', audioScope: 'local' })
      toast.error('请先填写你的答案。')
      return
    }
    emitQuizFeedback('quiz_generate_start', { label: 'AI点评', audioScope: 'global' })
    updateQuestionState(question.id, (current) => ({
      ...current,
      shortAnswerFeedbackLoading: true,
    }))
    try {
      const aiOptions = await promptForAiOptions({
        scenarioKey: 'quiz_short_answer_feedback',
        entrypointKey: 'quiz-short-answer-feedback',
        title: '简答题 AI 点评配置',
      })
      if (!aiOptions) {
        updateQuestionState(question.id, (current) => ({
          ...current,
          shortAnswerFeedbackLoading: false,
        }))
        emitQuizFeedback('quiz_generate_cancel', { label: '取消AI', audioScope: 'global' })
        return
      }
      const feedback = await requestPalaceShortAnswerFeedbackApi(question.id, userAnswer, aiOptions)
      updateQuestionState(question.id, (current) => ({
        ...current,
        shortAnswerFeedback: feedback,
        shortAnswerFeedbackLoading: false,
      }))
      emitQuizFeedback('quiz_result_ai_feedback_ready', { label: 'AI完成', audioScope: 'global' })
    } catch (nextError) {
      updateQuestionState(question.id, (current) => ({
        ...current,
        shortAnswerFeedbackLoading: false,
      }))
      emitQuizFeedback('quiz_error_ai_failed', { label: 'AI失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : 'AI 点评失败。')
    }
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
