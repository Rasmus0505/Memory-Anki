import { useEffect } from 'react'
import { readQuizSessionState, subscribeQuizSessionProgress } from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import type { QuizRuntimeState } from '@/modules/quiz/public'

/**
 * Mirror shared question progress into this window's local state.
 *
 * The learner can answer the same question from the 做题 overlay or another tab;
 * when that lands, the open 关联题目 window must show the new answer rather than
 * its stale copy. Only real progress counts — an empty state must not erase what
 * is on screen.
 *
 * Kept out of the dialog because it is pure bookkeeping: it owns no rendering and
 * touches only the question list and its state map.
 */
export function useQuizSessionProgressMirror({
  questionsRef,
  setQuestionStates,
}: {
  questionsRef: { current: PalaceQuizQuestion[] }
  setQuestionStates: (
    updater: (current: Record<number, QuizRuntimeState>) => Record<number, QuizRuntimeState>,
  ) => void
}) {
  useEffect(() => {
    return subscribeQuizSessionProgress(() => {
      setQuestionStates((current) => {
        let changed = false
        const next = { ...current }
        for (const question of questionsRef.current) {
          const incoming = readQuizSessionState(question.id)
          if (!incoming.resolved && !incoming.selectedOptionId && !incoming.rating) continue
          if (JSON.stringify(next[question.id]) === JSON.stringify(incoming)) continue
          next[question.id] = incoming
          changed = true
        }
        return changed ? next : current
      })
    })
  }, [questionsRef, setQuestionStates])
}
