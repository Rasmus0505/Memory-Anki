import { setPalaceQuizQuestionMarkedApi } from '@/modules/quiz/domain/quiz-entity/api'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'

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
}: {
  questionId: number
  marked: boolean
}) {
  const response = await setPalaceQuizQuestionMarkedApi(questionId, marked)
  return { question: response.item as PalaceQuizQuestion }
}
