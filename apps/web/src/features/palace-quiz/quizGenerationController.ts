import type {
  AiRuntimeOptions,
  AiScenarioRuntimeOptionsMap,
  MindMapEditorState,
  PalaceQuizGenerationPreview,
  PalaceQuizPdfSourceRole,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceQuizStreamDeltaEvent,
  PalaceQuizStreamStatusEvent,
} from '@/shared/api/contracts'
import {
  batchCreateChapterQuizQuestionsApi,
  batchCreatePalaceQuizQuestionsApi,
  previewPalaceQuizGenerationFromImagesApi,
  previewPalaceQuizGenerationFromPdfStreamApi,
  previewPalaceQuizGenerationFromReviewMindmapApi,
} from '@/shared/api/modules/quizzes'

export type QuizLauncherGenerationSourceKind =
  | 'subject-pdf'
  | 'image-single'
  | 'image-batch'
  | 'review-mindmap'

export interface QuizGenerationPdfSourceDraft {
  subject_document_id: number
  document_name: string
  page_selection: number[]
  role_hint: PalaceQuizPdfSourceRole
}

export interface QuizReviewMindmapGenerationConfig {
  mode: 'chapter' | 'cross_palace'
  question_types: PalaceQuizQuestionType[]
  question_count: number
  review_editor_doc: MindMapEditorState['editor_doc']
  related_palace_ids?: number[]
}

export interface QuizGenerationRequestConfig {
  palaceId: number
  selectedChapterId?: number | null
  sourceKind: QuizLauncherGenerationSourceKind
  extraPrompt: string
  aiOptions?: AiRuntimeOptions
  aiOptionsByScenario?: AiScenarioRuntimeOptionsMap
  files?: File[]
  pdfSources?: QuizGenerationPdfSourceDraft[]
  enableSecondaryReview?: boolean
  classifyByMiniPalace?: boolean
  reviewMindmap?: QuizReviewMindmapGenerationConfig
  onStatus?: (event: PalaceQuizStreamStatusEvent) => void
  onDelta?: (event: PalaceQuizStreamDeltaEvent) => void
}

export interface QuizAutoSaveGenerationResult {
  preview: PalaceQuizGenerationPreview
  savedCount: number
}

export function flattenGeneratedQuestions(
  preview: PalaceQuizGenerationPreview,
): PalaceQuizQuestionDraft[] {
  if (!preview.grouped_questions) {
    return preview.questions
  }
  if (preview.grouped_questions.child_chapter_groups) {
    return [
      ...preview.grouped_questions.child_chapter_groups.flatMap((group) =>
        group.questions.map((question) => ({
          ...question,
          classified_chapter_id: group.classified_chapter_id,
          mini_palace_id: null,
        })),
      ),
      ...preview.grouped_questions.unassigned_questions.map((question) => ({
        ...question,
        mini_palace_id: null,
        classified_chapter_id: null,
      })),
    ]
  }
  return [
    ...(preview.grouped_questions.mini_palace_groups || []).flatMap((group) => group.questions),
    ...preview.grouped_questions.unassigned_questions.map((question) => ({
      ...question,
      mini_palace_id: null,
    })),
  ]
}

export function buildGeneratedQuestionsForChapterSave(
  preview: PalaceQuizGenerationPreview,
  selectedChapterId: number,
): PalaceQuizQuestionDraft[] {
  const withSelectedChapterScope = (question: PalaceQuizQuestionDraft) => ({
    ...question,
    source_chapter_id: selectedChapterId,
    classified_chapter_id: null,
    mini_palace_id: null,
  })

  if (!preview.grouped_questions) {
    return preview.questions.map(withSelectedChapterScope)
  }
  if (preview.grouped_questions.child_chapter_groups) {
    return [
      ...preview.grouped_questions.child_chapter_groups.flatMap((group) =>
        group.questions.map((question) => ({
          ...question,
          source_chapter_id: selectedChapterId,
          classified_chapter_id: group.classified_chapter_id,
          mini_palace_id: null,
        })),
      ),
      ...preview.grouped_questions.unassigned_questions.map(withSelectedChapterScope),
    ]
  }
  return flattenGeneratedQuestions(preview).map(withSelectedChapterScope)
}

export function getGenerationPreviewSaveCount(preview: PalaceQuizGenerationPreview | null) {
  if (!preview) return 0
  return flattenGeneratedQuestions(preview).length
}

export async function generatePalaceQuizPreview(
  config: QuizGenerationRequestConfig,
): Promise<PalaceQuizGenerationPreview> {
  if (config.sourceKind === 'review-mindmap') {
    if (!config.reviewMindmap) {
      throw new Error('缺少复习脑图生成配置。')
    }
    return previewPalaceQuizGenerationFromReviewMindmapApi(config.palaceId, {
      ...config.reviewMindmap,
      ai_options: config.aiOptions,
    })
  }

  if (config.sourceKind === 'subject-pdf') {
    const pdfSources = config.pdfSources || []
    if (pdfSources.length === 0) {
      throw new Error('请先把至少一份 PDF 加入资料列表。')
    }
    return previewPalaceQuizGenerationFromPdfStreamApi(
      config.palaceId,
      {
        subject_document_id: pdfSources[0]?.subject_document_id,
        page_selection: pdfSources[0]?.page_selection || [],
        pdf_sources: pdfSources.map((item) => ({
          subject_document_id: item.subject_document_id,
          page_selection: item.page_selection,
          role_hint: item.role_hint,
        })),
        extra_prompt: config.extraPrompt,
        enable_secondary_review: config.enableSecondaryReview,
        classify_by_mini_palace: config.classifyByMiniPalace,
        selected_chapter_id: config.selectedChapterId,
        ai_options: config.aiOptions,
        ai_options_by_scenario: config.aiOptionsByScenario,
      },
      {
        onStatus: config.onStatus,
        onDelta: config.onDelta,
      },
    )
  }

  const files = config.files || []
  if (files.length === 0) {
    throw new Error('请先上传图片。')
  }
  return previewPalaceQuizGenerationFromImagesApi(
    config.palaceId,
    config.sourceKind === 'image-single' ? files.slice(0, 1) : files,
    config.extraPrompt,
    config.classifyByMiniPalace,
    config.selectedChapterId,
    config.aiOptions,
  )
}

export async function autoGenerateAndSavePalaceQuiz(
  config: QuizGenerationRequestConfig,
): Promise<QuizAutoSaveGenerationResult> {
  const preview = await generatePalaceQuizPreview(config)
  const questionsToSave = flattenGeneratedQuestions(preview)
  if (questionsToSave.length > 0) {
    if (config.selectedChapterId) {
      await batchCreateChapterQuizQuestionsApi(config.selectedChapterId, questionsToSave)
    } else {
      await batchCreatePalaceQuizQuestionsApi(config.palaceId, questionsToSave)
    }
  }
  return {
    preview,
    savedCount: questionsToSave.length,
  }
}
