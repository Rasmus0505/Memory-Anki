import { ratePalaceQuizQuestionScheduleApi } from '@/modules/quiz/domain/quiz-entity/api'
import {
  markQuizSessionCompleted,
  readQuizSessionState,
  writeQuizSessionState,
} from '@/modules/quiz/domain/quiz-entity/model/quizSessionProgress'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'

export function isFirstQuizRating(rating: number | undefined) {
  return rating == null || !Number.isInteger(rating) || rating <= 0
}

export async function submitQuizQuestionRating({
  questionId,
  rating,
  palaceId,
}: {
  questionId: number
  rating: number
  palaceId?: number | null
}) {
  const previous = readQuizSessionState(questionId)
  const isFirst = isFirstQuizRating(previous.rating)
  writeQuizSessionState(questionId, { ...previous, rating }, palaceId)
  markQuizSessionCompleted(questionId, palaceId)
  const response = await ratePalaceQuizQuestionScheduleApi(questionId, rating)
  return { isFirst, question: response.item as PalaceQuizQuestion }
}
