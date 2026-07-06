import { getSubjectTreeApi, getSubjectsApi } from '@/entities/knowledge/api'
import { getPalaceApi } from '@/entities/palace/api'
import {
  batchDeletePalaceQuizQuestionsApi,
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  getPalaceQuizQuestionsApi,
  recordPalaceQuizChoiceAttemptApi,
  requestPalaceQuestionExplainApi,
  requestPalaceShortAnswerFeedbackApi,
  resetPalaceQuizQuestionAttemptsApi,
  updatePalaceQuizQuestionApi,
} from '@/entities/quiz/api'

export {
  batchDeletePalaceQuizQuestionsApi,
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  getSubjectTreeApi,
  getSubjectsApi,
  recordPalaceQuizChoiceAttemptApi,
  requestPalaceQuestionExplainApi,
  requestPalaceShortAnswerFeedbackApi,
  resetPalaceQuizQuestionAttemptsApi,
  updatePalaceQuizQuestionApi,
}

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
