import type { PalaceQuizGenerationPreview } from '@/shared/api/contracts'
import {
  buildQuizGenerationHistoryTitle,
  getPreviewQuestionCount,
  saveQuizGenerationHistory,
  type QuizGenerationHistoryItem,
} from '@/features/palace-quiz/quiz-generation-history'
import type { QuizGenerationPdfSourceDraft } from '@/features/palace-quiz/quizGenerationController'
import type { QuizGenerationSourceKind } from '@/features/palace-quiz/model/palaceQuizPage'

export function persistQuizGenerationHistory(
  palaceId: number | null,
  preview: PalaceQuizGenerationPreview,
  sourceKind: QuizGenerationSourceKind,
  pdfSources: QuizGenerationPdfSourceDraft[],
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
    title: buildQuizGenerationHistoryTitle(
      sourceKind,
      pdfSources.map((item) => ({
        subject_document_id: item.subject_document_id,
        document_name: item.document_name,
        page_selection: [...item.page_selection],
        role_hint: item.role_hint,
      })),
      imageFileNames,
    ),
    extraPrompt,
    enableSecondaryReview,
    classifyByMiniPalace,
    selectedChapterId,
    selectedChapterPath: selectedChapterSummary !== '尚未选择题目所属章节' ? selectedChapterSummary : '',
    pdfSources: pdfSources.map((item) => ({
      subject_document_id: item.subject_document_id,
      document_name: item.document_name,
      page_selection: [...item.page_selection],
      role_hint: item.role_hint,
    })),
    imageFileNames,
    previewQuestionCount: preview.questions.length,
    savableQuestionCount: getPreviewQuestionCount(preview),
    aiCallLogId: preview.ai_call_log_id,
  })
}
