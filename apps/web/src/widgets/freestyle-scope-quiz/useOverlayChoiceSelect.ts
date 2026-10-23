import { useCallback } from 'react'

import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import type { QuizRuntimeState } from '@/modules/quiz/domain/quiz-entity/model/quizRuntime'
import { toggleQuizOptionSelection } from '@/modules/quiz/domain/quiz-entity/model/quizAnswerMode'

type UpdateLocalState = (
  questionId: number,
  updater: (state: QuizRuntimeState) => QuizRuntimeState,
) => void

type ChoiceResolve = (optionId: string | string[], isCorrect: boolean) => void

/** Choice shortcut handler for the freestyle scope overlay (single- and multi-select). */
export function useOverlayChoiceSelect(
  current: PalaceQuizQuestion | undefined,
  updateLocalState: UpdateLocalState,
  handleChoiceResolve: ChoiceResolve,
) {
  return useCallback(
    (optionIndex: number) => {
      const option = current?.options[optionIndex]
      if (!current || !option) return
      if ((current.answer_payload.correct_option_ids?.length ?? 0) > 1) {
        updateLocalState(current.id, (state) => ({
          ...state,
          selectedOptionIds: toggleQuizOptionSelection(state.selectedOptionIds, option.id),
        }))
        return
      }
      const correct = option.id === (current.answer_payload.correct_option_id || '')
      updateLocalState(current.id, (state) => ({
        ...state,
        selectedOptionId: option.id,
        resolved: true,
        correct,
      }))
      handleChoiceResolve(option.id, correct)
    },
    [current, handleChoiceResolve, updateLocalState],
  )
}
