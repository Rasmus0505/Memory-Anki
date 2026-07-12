import type { PalaceQuizGenerationPreview } from '@/shared/api/contracts'
import {
  buildQuizGenerationHistoryTitle,
  getPreviewQuestionCount,
  saveQuizGenerationHistory,
} from '@/features/palace-quiz/quiz-generation-history'
import type { QuizGenerationSourceKind } from '@/features/palace-quiz/model/palaceQuizPage'

export function persistQuizGenerationHistory(
  palaceId: number | null,
  preview: PalaceQuizGenerationPreview,
  sourceKind: QuizGenerationSourceKind,
  imageFileNames: string[],
  extraPrompt: string,
  enableSecondaryReview: boolean,
  classifyByMiniPalace: boolean,
  selectedChapterId: number | null,
  selectedChapterSummary: string,
) {
  if (!palaceId || typeof window === 'undefined') return null
  return saveQuizGenerationHistory(palaceId, {
    sourceKind,
    title: buildQuizGenerationHistoryTitle(sourceKind, imageFileNames),
    extraPrompt,
    enableSecondaryReview,
    classifyByMiniPalace,
    selectedChapterId,
    selectedChapterPath: selectedChapterSummary !== '尚未选择题目所属章节' ? selectedChapterSummary : '',
    imageFileNames,
    previewQuestionCount: preview.questions.length,
    savableQuestionCount: getPreviewQuestionCount(preview),
    aiCallLogId: preview.ai_call_log_id,
  })
}
