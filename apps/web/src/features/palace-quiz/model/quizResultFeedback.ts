import { emitReviewConfetti } from '@/shared/components/celebration'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

export interface QuizResultFeedbackOptions {
  correct: boolean
  reducedMotion?: boolean
}

export function emitQuizResultFeedback({
  correct,
  reducedMotion = false,
}: QuizResultFeedbackOptions) {
  const feedbackSettings = readReviewFeedbackSettings()
  dispatchGlobalFeedback(correct ? 'quiz_result_correct' : 'quiz_result_incorrect', {
    label: correct ? '答对' : '答错',
    screenPulse: correct ? 'soft' : null,
    audioScope: 'local',
  })
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(correct ? [30] : [40, 60, 40])
  }

  if (!correct) return
  if (feedbackSettings.mode !== 'immersive' || !feedbackSettings.scenes.quiz.enabled) return

  emitReviewConfetti({
    kind: 'quiz_correct',
    confettiAmount: feedbackSettings.scenes.quiz.confettiAmount,
    confettiPreset: feedbackSettings.scenes.quiz.confettiPreset,
    reducedMotion:
      reducedMotion ||
      feedbackSettings.reducedCelebrationMotion ||
      !feedbackSettings.animationEnabled ||
      !feedbackSettings.scenes.quiz.animationEnabled,
    soundEnabled: feedbackSettings.soundEnabled && feedbackSettings.scenes.quiz.soundEnabled,
    volume: getSceneEffectiveVolume(feedbackSettings, 'quiz'),
  })
}
