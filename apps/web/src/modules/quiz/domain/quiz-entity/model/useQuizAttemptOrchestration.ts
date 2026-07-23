import { useCallback } from 'react'
import { recordPalaceQuizChoiceAttemptApi, requestPalaceShortAnswerFeedbackApi } from '@/modules/quiz/domain/quiz-entity/api'
import { emitQuizResultFeedback } from '@/modules/quiz/domain/quiz-entity/model/quizResultFeedback'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'
import type { AiRuntimeOptions, PalaceQuizQuestion } from '@/shared/api/contracts'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'

type QuizFeedbackEvent = Parameters<typeof dispatchGlobalFeedback>[0]
type QuizFeedbackOptions = Parameters<typeof dispatchGlobalFeedback>[1]

export interface QuizAttemptStateAdapter {
  readQuestionState: (questionId: number) => QuizRuntimeState
  updateQuestionState: (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
  ) => void
  applyUpdatedQuestion: (question: PalaceQuizQuestion) => void
}

export function useQuizAttemptOrchestration({
  adapter,
  promptForAiOptions,
  shortAnswerEntrypointKey,
  resultFeedbackMode,
  emitFeedback,
  onChoiceStart,
  emitChoiceStatErrorFeedback = false,
}: {
  adapter: QuizAttemptStateAdapter
  promptForAiOptions: (options: {
    scenarioKey: string
    entrypointKey: string
    title: string
  }) => Promise<AiRuntimeOptions | null | undefined>
  shortAnswerEntrypointKey: string
  resultFeedbackMode: 'immediate' | 'external'
  emitFeedback: (event: QuizFeedbackEvent, options?: QuizFeedbackOptions) => void
  onChoiceStart?: (options: {
    question: PalaceQuizQuestion
    optionId: string
    correct: boolean
  }) => void
  emitChoiceStatErrorFeedback?: boolean
}) {
  const handleChoiceSelect = useCallback(
    (question: PalaceQuizQuestion, optionId: string, correctOverride?: boolean) => {
      const currentState = adapter.readQuestionState(question.id)
      // Skip duplicate handling when already resolved, unless the caller explicitly
      // supplies correctOverride (freestyle resolves UI state first in the same click).
      if (currentState.resolved && correctOverride === undefined) return
      const correct = correctOverride ?? question.answer_payload.correct_option_id === optionId
      onChoiceStart?.({ question, optionId, correct })
      void recordPalaceQuizChoiceAttemptApi(question.id, optionId)
        .then((response) => {
          adapter.applyUpdatedQuestion(response.question)
          if (resultFeedbackMode !== 'immediate') return
          emitQuizResultFeedback({ correct })
          emitFeedback('quiz_result_reveal', {
            label: correct ? '揭晓' : '答案',
            screenPulse: null,
            audioScope: 'local',
          })
        })
        .catch((error) => {
          if (emitChoiceStatErrorFeedback) {
            emitFeedback('quiz_error_stat_failed', { label: '统计失败', audioScope: 'local' })
          }
          toast.error(error instanceof Error ? error.message : '统计刷新失败。')
        })
    },
    [
      adapter,
      emitChoiceStatErrorFeedback,
      emitFeedback,
      onChoiceStart,
      resultFeedbackMode,
    ],
  )

  const handleShortAnswerSubmit = useCallback(
    (questionId: number) => {
      adapter.updateQuestionState(questionId, (state) => ({
        ...state,
        resolved: true,
        shortAnswerSubmitted: true,
        shortAnswerFeedback: null,
      }))
    },
    [adapter],
  )

  const handleShortAnswerFeedback = useCallback(
    async (question: PalaceQuizQuestion) => {
      const state = adapter.readQuestionState(question.id)
      const userAnswer = state.shortAnswerText?.trim() || ''
      if (!userAnswer) {
        emitFeedback('quiz_error_missing_input', { label: '先写答案', audioScope: 'local' })
        toast.error('请先填写你的答案。')
        return
      }
      emitFeedback('quiz_generate_start', { label: 'AI点评', audioScope: 'global' })
      adapter.updateQuestionState(question.id, (current) => ({
        ...current,
        shortAnswerFeedbackLoading: true,
      }))
      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: 'quiz_short_answer_feedback',
          entrypointKey: shortAnswerEntrypointKey,
          title: '简答题 AI 点评配置',
        })
        if (!aiOptions) {
          adapter.updateQuestionState(question.id, (current) => ({
            ...current,
            shortAnswerFeedbackLoading: false,
          }))
          emitFeedback('quiz_generate_cancel', { label: '取消AI', audioScope: 'global' })
          return
        }
        const feedback = await requestPalaceShortAnswerFeedbackApi(question.id, userAnswer, aiOptions)
        adapter.updateQuestionState(question.id, (current) => ({
          ...current,
          shortAnswerFeedback: feedback,
          shortAnswerFeedbackLoading: false,
        }))
        emitFeedback('quiz_result_ai_feedback_ready', { label: 'AI完成', audioScope: 'global' })
      } catch (error) {
        adapter.updateQuestionState(question.id, (current) => ({
          ...current,
          shortAnswerFeedbackLoading: false,
        }))
        emitFeedback('quiz_error_ai_failed', { label: 'AI失败', audioScope: 'global' })
        toast.error(error instanceof Error ? error.message : 'AI 点评失败。')
      }
    },
    [adapter, emitFeedback, promptForAiOptions, shortAnswerEntrypointKey],
  )

  return {
    handleChoiceSelect,
    handleShortAnswerSubmit,
    handleShortAnswerFeedback,
  }
}
