import { API_BASE, fetchWithMutationQueue, request, uploadWithFormData } from '@/shared/api/http'
import { readJsonResponse } from '@/shared/api/jsonResponse'
import type {
  MindMapEditorState,
  PalaceQuizMiniPalaceClassificationResult,
  PalaceQuizGenerationPreview,
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceShortAnswerFeedback,
} from '@/shared/api/contracts'

async function readQuizJson<T>(response: Response): Promise<T> {
  return readJsonResponse<T>(response, { feature: 'Palace quiz API' })
}

export function getPalaceQuizQuestionsApi(palaceId: number) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/aggregated-quiz-questions`)
}

export function getChapterQuizQuestionsApi(chapterId: number) {
  return request<{ items: PalaceQuizQuestion[] }>(`/chapters/${chapterId}/quiz-questions`)
}

export function createPalaceQuizQuestionApi(
  palaceId: number,
  data: PalaceQuizQuestionDraft,
) {
  return request<{ item: PalaceQuizQuestion }>(`/palaces/${palaceId}/quiz-questions`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-question:create`,
      description: '新增宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function batchCreatePalaceQuizQuestionsApi(
  palaceId: number,
  questions: PalaceQuizQuestionDraft[],
) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/quiz-questions/batch`, {
    method: 'POST',
    body: JSON.stringify({ questions }),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-question:batch-create`,
      description: '批量保存宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function batchCreateChapterQuizQuestionsApi(
  chapterId: number,
  questions: PalaceQuizQuestionDraft[],
  saveMode: 'append' | 'overwrite' = 'append',
) {
  return request<{ items: PalaceQuizQuestion[] }>(`/chapters/${chapterId}/quiz-questions/batch`, {
    method: 'POST',
    body: JSON.stringify({ questions, save_mode: saveMode }),
    persistence: {
      resourceKey: `chapter:${chapterId}:quiz-question:batch-create:${saveMode}`,
      description: '批量保存章节题目',
      replayMode: 'manual',
    },
  })
}

export function updatePalaceQuizQuestionApi(
  questionId: number,
  data: PalaceQuizQuestionDraft,
) {
  return request<{ item: PalaceQuizQuestion }>(`/palace-quiz-questions/${questionId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}`,
      coalesceKey: `palace-quiz-question:${questionId}`,
      description: '保存宫殿题目',
      replayMode: 'auto',
    },
  })
}

export function deletePalaceQuizQuestionApi(questionId: number) {
  return request<{ ok: boolean }>(`/palace-quiz-questions/${questionId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:delete`,
      description: '删除宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function batchDeletePalaceQuizQuestionsApi(questionIds: number[]) {
  return request<{ ok: boolean; deleted_count: number }>(`/palace-quiz-questions/batch-delete`, {
    method: 'POST',
    body: JSON.stringify({ question_ids: questionIds }),
    persistence: {
      resourceKey: `palace-quiz-question:batch-delete:${questionIds.join(',')}`,
      description: '批量删除宫殿题目',
      replayMode: 'manual',
    },
  })
}

export function resetPalaceQuizQuestionAttemptsApi(questionIds: number[]) {
  return request<{ ok: boolean; reset_count: number }>(`/palace-quiz-questions/reset-attempts`, {
    method: 'POST',
    body: JSON.stringify({ question_ids: questionIds }),
    persistence: {
      resourceKey: `palace-quiz-question:reset-attempts:${questionIds.join(',')}`,
      description: '清空做题进度',
      replayMode: 'manual',
    },
  })
}

export function recordPalaceQuizChoiceAttemptApi(
  questionId: number,
  selectedOptionId: string,
) {
  return request<{
    question: PalaceQuizQuestion
    selected_option_id: string
    is_correct: boolean
  }>(`/palace-quiz-questions/${questionId}/choice-attempts`, {
    method: 'POST',
    body: JSON.stringify({ selected_option_id: selectedOptionId }),
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:attempt:${selectedOptionId}`,
      description: '累计选择题作答统计',
      replayMode: 'manual',
    },
  })
}

export function requestPalaceShortAnswerFeedbackApi(
  questionId: number,
  userAnswer: string,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return request<PalaceShortAnswerFeedback>(
    `/palace-quiz-questions/${questionId}/short-answer-feedback`,
    {
      method: 'POST',
      body: JSON.stringify({ user_answer: userAnswer, ai_options: aiOptions }),
      persistence: {
        resourceKey: `palace-quiz-question:${questionId}:short-feedback`,
        description: '生成简答题 AI 点评',
        replayMode: 'manual',
      },
    },
  )
}

function buildPalaceQuizGenerationUploadForm(input: {
  files: File[]
  extraPrompt: string
  classifyByMiniPalace: boolean
  selectedChapterId?: number | null
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions
}) {
  const form = new FormData()
  input.files.forEach((file) => form.append('files', file))
  form.append('extra_prompt', input.extraPrompt)
  form.append('classify_by_mini_palace', input.classifyByMiniPalace ? 'true' : 'false')
  if (input.selectedChapterId) {
    form.append('selected_chapter_id', String(input.selectedChapterId))
  }
  if (input.aiOptions) {
    form.append('ai_options', JSON.stringify(input.aiOptions))
  }
  return form
}

function previewPalaceQuizGenerationFromUploadedFiles(
  palaceId: number,
  kind: 'images' | 'text-files',
  files: File[],
  extraPrompt: string,
  classifyByMiniPalace: boolean,
  selectedChapterId?: number | null,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return uploadWithFormData<PalaceQuizGenerationPreview>(
    `/palaces/${palaceId}/quiz-generation/${kind}`,
    buildPalaceQuizGenerationUploadForm({
      files,
      extraPrompt,
      classifyByMiniPalace,
      selectedChapterId,
      aiOptions,
    }),
    {
      resourceKey: `palace:${palaceId}:quiz-generation:${kind}:${files.map((file) => file.name).join(',')}`,
      description:
        kind === 'images'
          ? 'AI 生成宫殿题目（图片）'
          : 'AI 生成宫殿题目（文本文件）',
    },
  )
}

export async function previewPalaceQuizGenerationFromImagesApi(
  palaceId: number,
  files: File[],
  extraPrompt: string,
  classifyByMiniPalace = false,
  selectedChapterId?: number | null,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return previewPalaceQuizGenerationFromUploadedFiles(
    palaceId,
    'images',
    files,
    extraPrompt,
    classifyByMiniPalace,
    selectedChapterId,
    aiOptions,
  )
}

export async function previewPalaceQuizGenerationFromTextFilesApi(
  palaceId: number,
  files: File[],
  extraPrompt: string,
  classifyByMiniPalace = false,
  selectedChapterId?: number | null,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return previewPalaceQuizGenerationFromUploadedFiles(
    palaceId,
    'text-files',
    files,
    extraPrompt,
    classifyByMiniPalace,
    selectedChapterId,
    aiOptions,
  )
}

export function previewChapterQuizGenerationFromOutlineApi(
  chapterId: number,
  data: {
    question_types?: PalaceQuizQuestionType[]
    question_count?: number
    extra_prompt: string
    classify_by_child_chapter?: boolean
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
) {
  return request<PalaceQuizGenerationPreview>(`/chapters/${chapterId}/quiz-generation/outline`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `chapter:${chapterId}:quiz-generation:outline:${data.question_types?.join(',') || 'default'}:${data.question_count || 5}`,
      description: 'AI 生成章节题目',
      replayMode: 'manual',
    },
  })
}

export function classifyPalaceQuizQuestionsToMiniPalacesApi(
  palaceId: number,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return request<PalaceQuizMiniPalaceClassificationResult>(
    `/palaces/${palaceId}/quiz-classification/mini-palaces`,
    {
      method: 'POST',
      body: JSON.stringify(aiOptions ? { ai_options: aiOptions } : {}),
      persistence: {
        resourceKey: `palace:${palaceId}:quiz-classification:mini-palaces`,
        description: '把大宫殿题库归类到小宫殿',
        replayMode: 'manual',
      },
    },
  )
}

export function previewPalaceQuizGenerationFromReviewMindmapApi(
  palaceId: number,
  data: {
    mode: 'chapter' | 'cross_palace'
    question_types: PalaceQuizQuestionType[]
    question_count: number
    review_editor_doc: MindMapEditorState['editor_doc']
    related_palace_ids?: number[]
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
) {
  return request<PalaceQuizGenerationPreview>(
    `/palaces/${palaceId}/quiz-generation/review-mindmap`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `palace:${palaceId}:quiz-generation:review-mindmap:${data.mode}:${data.question_types.join(',')}:${data.question_count}`,
        description: 'AI 生成做题题目',
        replayMode: 'manual',
      },
    },
  )
}
