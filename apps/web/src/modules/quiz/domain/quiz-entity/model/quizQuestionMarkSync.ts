type QuizQuestionMarkListener = (questionId: number, marked: boolean) => void

const listeners = new Set<QuizQuestionMarkListener>()

/** Tell open mindmap badge hosts that a question mark just changed. */
export function publishQuizQuestionMarked(questionId: number, marked: boolean) {
  for (const listener of listeners) listener(questionId, marked)
}

export function subscribeQuizQuestionMarked(listener: QuizQuestionMarkListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
