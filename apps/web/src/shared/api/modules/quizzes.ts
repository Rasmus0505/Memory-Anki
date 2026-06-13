import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  PalaceQuizMiniPalaceClassificationResult,
  PalaceQuizGenerationPreview,
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceShortAnswerFeedback,
} from '@/shared/api/contracts'

async function readQuizJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `HTTP ${response.status}`)
  }
  return data as T
}

export function getPalaceQuizQuestionsApi(palaceId: number) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/quiz-questions`)
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

export async function previewPalaceQuizGenerationFromImagesApi(
  palaceId: number,
  files: File[],
  extraPrompt: string,
  classifyByMiniPalace = false,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  const form = new FormData()
  files.forEach((file) => form.append('files', file))
  form.append('extra_prompt', extraPrompt)
  form.append('classify_by_mini_palace', classifyByMiniPalace ? 'true' : 'false')
  if (aiOptions) {
    form.append('ai_options', JSON.stringify(aiOptions))
  }
  const response = await fetchWithMutationQueue(
    `${API_BASE}/palaces/${palaceId}/quiz-generation/images`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `palace:${palaceId}:quiz-generation:images:${files.map((file) => file.name).join(',')}`,
      description: 'AI 生成宫殿题目（图片）',
      replayMode: 'manual',
    },
  )
  return readQuizJson<PalaceQuizGenerationPreview>(response)
}

export function previewPalaceQuizGenerationFromPdfApi(
  palaceId: number,
  data: {
    subject_document_id: number
    page_selection: number[]
    extra_prompt: string
    classify_by_mini_palace?: boolean
    ai_options?: import('@/shared/api/contracts').AiRuntimeOptions
  },
) {
  return request<PalaceQuizGenerationPreview>(`/palaces/${palaceId}/quiz-generation/pdf`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-generation:pdf:${data.subject_document_id}`,
      description: 'AI 生成宫殿题目（PDF）',
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
