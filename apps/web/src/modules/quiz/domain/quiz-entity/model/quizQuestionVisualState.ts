import type { QuizRuntimeState } from './quizRuntime'

export type QuizQuestionAttentionTone = 'danger' | 'rose' | null

/**
 * One attention-tone rule for every question surface.
 * A wrong answer is the stronger signal and therefore overrides a manual mark.
 */
export function resolveQuizQuestionAttentionTone(input: {
  marked?: boolean
  wrong?: boolean
}): QuizQuestionAttentionTone {
  if (input.wrong) return 'danger'
  if (input.marked) return 'rose'
  return null
}

/** Local answer evidence used by map badges before a round response arrives. */
export function isWrongQuizRuntimeState(state: QuizRuntimeState | undefined): boolean {
  return state?.resolved === true && state.correct === false
}
