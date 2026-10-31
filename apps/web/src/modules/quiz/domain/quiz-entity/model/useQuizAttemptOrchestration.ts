import { useCallback } from 'react'
import { recordPalaceQuizChoiceAttemptApi, requestPalaceShortAnswerFeedbackApi } from '@/modules/quiz/domain/quiz-entity/api'
import { isQuizChoiceAttemptClosed } from '@/modules/quiz/domain/quiz-entity/model/quizAnswerMode'
import { withOptimisticQuizAttempt } from '@/modules/quiz/domain/quiz-entity/model/quizAttemptStats'
import { showQuizMutationMarkedToast } from '@/modules/quiz/domain/quiz-entity/model/quizMutationFeedback'
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
  shouldToastAttemptError,
  getDurationMs,
  updateMutationStats = true,
  applyQuestionUpdates = true,
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
    optionId: string | string[]
    correct: boolean
  }) => void
  emitChoiceStatErrorFeedback?: boolean
  /** Return false to swallow a stat-refresh failure, e.g. the question was just deleted. */
  shouldToastAttemptError?: (questionId: number) => boolean
  /** Milliseconds from the question becoming visible to this attempt. */
  getDurationMs?: (questionId: number) => number | null
  /**
   * False when another write owns the muscle-memory counters, e.g. the
   * freestyle history record applies them after its own attempt row.
   */
  updateMutationStats?: boolean
  /**
   * False when the caller applies a later authoritative question response
   * itself; avoids a stale choice response overwriting the history update.
   */
  applyQuestionUpdates?: boolean
}) {
  const handleChoiceSelect = useCallback(
    (question: PalaceQuizQuestion, optionId: string | string[], correctOverride?: boolean) => {
      const currentState = adapter.readQuestionState(question.id)
      // Skip a second choice record. Subjective recall sets resolved without a
      // selected option, and freestyle may resolve the choice in the same click.
      if (isQuizChoiceAttemptClosed(currentState) && correctOverride === undefined) return
      const correct = correctOverride ?? (Array.isArray(optionId)
        ? optionId.length > 0 &&
          optionId.every((item) => (question.answer_payload.correct_option_ids || []).includes(item)) &&
          optionId.length === (question.answer_payload.correct_option_ids || []).length
        : question.answer_payload.correct_option_id === optionId)
      onChoiceStart?.({ question, optionId, correct })
      adapter.applyUpdatedQuestion(withOptimisticQuizAttempt(question, correct))
      // The learner's answer is final the moment they pick it, so the result cue
      // belongs to that tap — never to the write. A contended SQLite lock (or the
      // mutation queue behind it) could hold the POST for a second and the cue then
      // landed while the next question was already on screen. Only the attempt
      // record itself still waits for the server.
      if (resultFeedbackMode === 'immediate') {
        emitQuizResultFeedback({ correct })
        emitFeedback('quiz_result_reveal', {
          label: correct ? '揭晓' : '答案',
          screenPulse: null,
          audioScope: 'local',
        })
      }
      void recordPalaceQuizChoiceAttemptApi(question.id, optionId, {
        durationMs: getDurationMs?.(question.id) ?? null,
        updateMutationStats,
      })
        .then((response) => {
          if (applyQuestionUpdates) adapter.applyUpdatedQuestion(response.question)
          if (response.auto_marked) {
            showQuizMutationMarkedToast(response.auto_mark_threshold_ms)
          }
        })
        .catch((error) => {
          if (shouldToastAttemptError && !shouldToastAttemptError(question.id)) return
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
      getDurationMs,
      onChoiceStart,
      resultFeedbackMode,
      shouldToastAttemptError,
      updateMutationStats,
      applyQuestionUpdates,
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
