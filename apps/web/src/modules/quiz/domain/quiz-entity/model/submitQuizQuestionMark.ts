import { setPalaceQuizQuestionMarkedApi } from '@/modules/quiz/domain/quiz-entity/api'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { isBusyResponseError } from '@/shared/api/busyRetry'
import { publishQuizQuestionMarked } from '@/modules/quiz/domain/quiz-entity/model/quizQuestionMarkSync'

const markRequestTokens = new Map<number, number>()

export function beginQuizQuestionMarkRequest(questionId: number) {
  const token = (markRequestTokens.get(questionId) ?? 0) + 1
  markRequestTokens.set(questionId, token)
  return token
}

export function isCurrentQuizQuestionMarkRequest(questionId: number, token: number) {
  return markRequestTokens.get(questionId) === token
}

export async function submitQuizQuestionMark({
  questionId,
  marked,
  token,
}: {
  questionId: number
  marked: boolean
  token?: number
}) {
  const response = await setPalaceQuizQuestionMarkedApi(questionId, marked)
  const saved = response.item as PalaceQuizQuestion
  const savedMarked = Boolean(saved?.marked ?? marked)
  if (token == null || isCurrentQuizQuestionMarkRequest(questionId, token)) {
    publishQuizQuestionMarked(questionId, savedMarked)
  }
  return { question: saved, marked: savedMarked }
}

/**
 * Paint the mark immediately, then persist it.
 *
 * The mark endpoint waits out the storage lock and answers 503 when that lock
 * is still held. Waiting for that response before changing the button made the
 * click look dead. A busy failure stays on screen because the request is queued
 * for auto-replay; any other failure restores the previous value.
 */
export async function commitQuizQuestionMark({
  questionId,
  marked,
  previousMarked,
  token,
  stillCurrent = () => isCurrentQuizQuestionMarkRequest(questionId, token),
  apply,
}: {
  questionId: number
  marked: boolean
  previousMarked: boolean
  token: number
  stillCurrent?: () => boolean
  apply: (marked: boolean, saved?: PalaceQuizQuestion) => void
}) {
  apply(marked)
  publishQuizQuestionMarked(questionId, marked)
  try {
    const { question, marked: savedMarked } = await submitQuizQuestionMark({
      questionId,
      marked,
      token,
    })
    if (!stillCurrent()) return
    apply(savedMarked, question)
  } catch (error) {
    if (!stillCurrent()) return
    if (isBusyResponseError(error)) return
    apply(previousMarked)
    publishQuizQuestionMarked(questionId, previousMarked)
    throw error
  }
}
