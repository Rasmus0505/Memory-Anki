import { getSubjectTreeApi, getSubjectsApi, uploadSubjectDocumentApi } from '@/entities/knowledge/api/knowledgeApi'
import { getPalaceApi } from '@/entities/palace/api'
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
  resetPalaceQuizQuestionAttemptsApi,
  updatePalaceQuizQuestionApi,
} from '@/entities/quiz/api/quizApi'

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
  resetPalaceQuizQuestionAttemptsApi,
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
