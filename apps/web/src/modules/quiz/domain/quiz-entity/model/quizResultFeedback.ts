import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { triggerHaptic } from '@/shared/feedback/haptics'

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
  // Incorrect answers deliberately avoid punitive vibration, shake or full-screen effects.
  if (correct && !reducedMotion) triggerHaptic('success')
}
