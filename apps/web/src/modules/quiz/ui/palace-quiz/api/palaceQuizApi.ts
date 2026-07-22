import { getPalaceApi } from '@/modules/content/public'
import { getPalaceQuizQuestionsApi } from '@/modules/quiz/domain/quiz-entity/api'

export async function loadPalaceQuizPageData(palaceId: number) {
  const [palace, questions] = await Promise.all([
    getPalaceApi(palaceId),
    getPalaceQuizQuestionsApi(palaceId),
  ])
  return {
    palace,
    questions: questions.items || [],
  }
}

export async function loadPalaceQuizQuestions(palaceId: number) {
  const result = await getPalaceQuizQuestionsApi(palaceId)
  return result.items || []
}
