import { toast } from '@/shared/feedback/toast'

export const QUIZ_MUTATION_MARKED_DURATION_MS = 2_500

export function quizMutationMarkedMessage(thresholdMs?: number | null): string {
  const seconds = thresholdMs && thresholdMs > 0 ? thresholdMs / 1000 : 5
  const label = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
  return `⚡ 检测到肌肉记忆（连续答对且耗时 <${label}s），已自动标记为「待换题」`
}

export function showQuizMutationMarkedToast(thresholdMs?: number | null) {
  toast.info(quizMutationMarkedMessage(thresholdMs), {
    duration: QUIZ_MUTATION_MARKED_DURATION_MS,
    // The learner asked for a non-blocking top-right cue that does not cover
    // the answering chrome at the bottom of the practice surface.
    position: 'top-right',
  })
}
