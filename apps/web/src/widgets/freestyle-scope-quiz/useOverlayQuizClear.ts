import { useCallback } from 'react'
import {
  clearQuizSessionProgress,
  clearQuizSessionProgressForPalaces,
  removeQuizSessionQuestions,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import { toast } from '@/shared/feedback/toast'
import type { QuizProgressClearChoice } from '@/widgets/quiz-progress-clear/QuizProgressClearDialog'
import type { FreestyleOverlayQuizState, PalaceQuizQuestion } from '@/shared/api/contracts'

/**
 * 清除进度 for the 做题 overlay: current question, one palace, or everything.
 *
 * Extracted from `FreestyleScopeQuizDialog` because it is a self-contained
 * decision plus three side effects (SPA session mirror, overlay state map, and
 * the debounced plan write). The dialog keeps owning the state; this only
 * applies a chosen scope to it.
 */
export function useOverlayQuizClear({
  overlay,
  questions,
  current,
  questionStates,
  index,
  setQuestionStates,
  persistProgress,
}: {
  overlay: FreestyleOverlayQuizState | null
  questions: PalaceQuizQuestion[]
  current: PalaceQuizQuestion | null
  questionStates: Record<number, QuizRuntimeState>
  index: number
  setQuestionStates: (next: Record<number, QuizRuntimeState>) => void
  persistProgress: (nextIndex: number, nextStates: Record<number, QuizRuntimeState>) => void
}) {
  return useCallback((choice: QuizProgressClearChoice) => {
    // The overlay's own mapping wins: a question may be answered in a palace
    // context that differs from its stored owner.
    const palaceOf = (question: PalaceQuizQuestion) => {
      const mapped = overlay?.question_palace_ids?.[String(question.id)]
      return typeof mapped === 'number' && mapped > 0 ? mapped : question.palace_id ?? null
    }
    const publish = (nextStates: Record<number, QuizRuntimeState>) => {
      setQuestionStates(nextStates)
      persistProgress(index, nextStates)
    }
    if (choice.scope === 'question') {
      if (!current) return
      removeQuizSessionQuestions([current.id])
      const nextStates = { ...questionStates }
      delete nextStates[current.id]
      publish(nextStates)
      toast.success('已清除当前题的做题进度。')
      return
    }
    if (choice.scope === 'palace') {
      const targetPalaceId = choice.palaceId
      if (!targetPalaceId) return
      clearQuizSessionProgressForPalaces([targetPalaceId])
      const ids = questions
        .filter((item) => palaceOf(item) === targetPalaceId)
        .map((item) => item.id)
      if (ids.length > 0) removeQuizSessionQuestions(ids)
      const nextStates = { ...questionStates }
      for (const id of ids) delete nextStates[id]
      publish(nextStates)
      toast.success('已清除所选宫殿的做题进度。')
      return
    }
    clearQuizSessionProgress()
    publish({})
    toast.success('已清除全部题目的做题进度。')
  }, [current, index, overlay, persistProgress, questionStates, questions, setQuestionStates])
}
