import type { PalaceQuizQuestion } from '@/shared/api/contracts'

export function formatQuizAttemptStats(correctCount: number, attemptCount: number): string {
  return `${correctCount}/${attemptCount}`
}

/** Local bump before the attempt API returns authoritative counts. */
export function withOptimisticQuizAttempt(
  question: PalaceQuizQuestion,
  correct: boolean,
): PalaceQuizQuestion {
  return {
    ...question,
    attempt_count: question.attempt_count + 1,
    correct_count: correct ? question.correct_count + 1 : question.correct_count,
    incorrect_count: correct ? question.incorrect_count : question.incorrect_count + 1,
  }
}
