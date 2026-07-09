import { getPalaceApi } from '@/entities/palace/api'
import { getPalaceQuizQuestionsApi } from '@/entities/quiz/api'

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
