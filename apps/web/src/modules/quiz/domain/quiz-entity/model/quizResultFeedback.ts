import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

export interface QuizResultFeedbackOptions {
  correct: boolean
  reducedMotion?: boolean
}

export function emitQuizResultFeedback({
  correct,
  reducedMotion = false,
}: QuizResultFeedbackOptions) {
  dispatchGlobalFeedback(correct ? 'quiz_result_correct' : 'quiz_result_incorrect', {
    audioScope: 'local',
  })
  // Correct answers may use a tiny affirmative haptic cue. Incorrect answers
  // deliberately avoid punitive vibration, shake or full-screen effects.
  if (
    correct &&
    !reducedMotion &&
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function'
  ) {
    navigator.vibrate(18)
  }
}
