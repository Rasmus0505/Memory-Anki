import type { AiRuntimeOptions, PalaceQuizGenerationPreview } from '@/shared/api/contracts'
import {
  addQuizFileSourceApi,
  createQuizGenerationJobApi,
  deleteQuizGenerationJobApi,
  listQuizGenerationJobsApi,
  updateQuizGenerationJobApi,
} from '@/modules/quiz/ui/palace-quiz/api'
import {
  buildQuizGenerationHistoryTitle,
  getPreviewQuestionCount,
  mapQuizGenerationJobToHistory,
} from '@/modules/quiz/ui/palace-quiz/quiz-generation-history'
import type { QuizGenerationSourceKind } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'

export async function loadPersistentQuizGenerationHistory(palaceId: number) {
  const response = await listQuizGenerationJobsApi(palaceId)
  return response.items
    .filter((job) => job.options.quick_generation === true)
    .map(mapQuizGenerationJobToHistory)
}

export async function deletePersistentQuizGenerationHistory(jobId: string) {
  await deleteQuizGenerationJobApi(jobId)
}

export async function persistQuizGenerationHistory(
  palaceId: number | null,
  preview: PalaceQuizGenerationPreview,
  sourceKind: QuizGenerationSourceKind,
  files: File[],
  extraPrompt: string,
  enableSecondaryReview: boolean,
  classifyByMiniPalace: boolean,
  selectedChapterId: number | null,
  selectedChapterSummary: string,
  aiOptions?: AiRuntimeOptions,
) {
  if (!palaceId) return null
  const imageFileNames = files.map((file) => file.name)
  const title = buildQuizGenerationHistoryTitle(sourceKind, imageFileNames)
  const created = await createQuizGenerationJobApi(palaceId, {
    selected_chapter_id: selectedChapterId,
    title,
    extra_prompt: extraPrompt,
    options: {
      source_kind: sourceKind,
      quick_generation: true,
      enable_secondary_review: enableSecondaryReview,
      classify_by_mini_palace: classifyByMiniPalace,
      selected_chapter_path: selectedChapterSummary !== '尚未选择题目所属章节' ? selectedChapterSummary : '',
      preview_question_count: preview.questions.length,
      savable_question_count: getPreviewQuestionCount(preview),
      ai_options: aiOptions || {},
    },
  })
  try {
    for (const file of files) {
      await addQuizFileSourceApi(created.item.id, 'question', file)
    }
    const updated = await updateQuizGenerationJobApi(created.item.id, {
      status: 'preview',
      preview,
    })
    return mapQuizGenerationJobToHistory(updated.item)
  } catch (error) {
    await deleteQuizGenerationJobApi(created.item.id).catch(() => undefined)
    throw error
  }
}
