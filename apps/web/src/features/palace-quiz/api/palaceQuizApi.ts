import { getSubjectTreeApi, getSubjectsApi, uploadSubjectDocumentApi } from '@/shared/api/modules/knowledge'
import { getPalaceApi } from '@/shared/api/modules/palaces'
import {
  batchDeletePalaceQuizQuestionsApi,
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  getPalaceQuizQuestionsApi,
  recordPalaceQuizChoiceAttemptApi,
  recoverAndSavePalaceQuizGenerationFromAiLogApi,
  requestPalaceShortAnswerFeedbackApi,
  updatePalaceQuizQuestionApi,
} from '@/shared/api/modules/quizzes'

export {
  batchDeletePalaceQuizQuestionsApi,
  batchCreateChapterQuizQuestionsApi,
  classifyPalaceQuizQuestionsToMiniPalacesApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  getSubjectTreeApi,
  getSubjectsApi,
  recordPalaceQuizChoiceAttemptApi,
  recoverAndSavePalaceQuizGenerationFromAiLogApi,
  requestPalaceShortAnswerFeedbackApi,
  updatePalaceQuizQuestionApi,
  uploadSubjectDocumentApi,
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
