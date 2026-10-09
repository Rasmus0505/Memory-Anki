import { request } from '@/shared/api/http'
import { invalidateSharedRequest } from '@/shared/api/inFlightRequest'
import type {
  PalaceQuizOcrSource,
  PalaceQuizOcrSourceDraft,
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuestionExplainResult,
  PalaceShortAnswerFeedback,
  QuizNodeBindingEdge,
} from '@/shared/api/contracts'

export function getPalaceQuizQuestionsApi(palaceId: number) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/aggregated-quiz-questions`)
}

export function getPalaceQuizOcrSourcesApi(palaceId: number) {
  return request<{ items: PalaceQuizOcrSource[] }>(`/palaces/${palaceId}/quiz-ocr-sources`)
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
  ocrSources?: PalaceQuizOcrSourceDraft[],
) {
  return request<{ items: PalaceQuizQuestion[] }>(`/palaces/${palaceId}/quiz-questions/batch`, {
    method: 'POST',
    body: JSON.stringify({ questions, ocr_sources: ocrSources || [] }),
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
  options?: { palaceId?: number | null; ocrSources?: PalaceQuizOcrSourceDraft[] },
) {
  return request<{ items: PalaceQuizQuestion[] }>(`/chapters/${chapterId}/quiz-questions/batch`, {
    method: 'POST',
    body: JSON.stringify({
      questions,
      save_mode: saveMode,
      palace_id: options?.palaceId ?? null,
      ocr_sources: options?.ocrSources || [],
    }),
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

export function getQuizTrashApi(limit = 50, offset = 0) {
  return request<{
    items: import('@/shared/api/contracts').QuizTrashItem[]
    total: number
    limit: number
    offset: number
  }>(`/palace-quiz-questions/trash?limit=${limit}&offset=${offset}`)
}

export function restorePalaceQuizQuestionApi(questionId: number) {
  return request<{ item: PalaceQuizQuestion }>(`/palace-quiz-questions/${questionId}/restore`, {
    method: 'POST',
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:restore`,
      description: '从回收站恢复题目',
      replayMode: 'manual',
    },
  })
}

export function permanentDeletePalaceQuizQuestionApi(questionId: number) {
  return request<{ ok: boolean }>(`/palace-quiz-questions/${questionId}/permanent`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:permanent-delete`,
      description: '永久删除题目',
      replayMode: 'manual',
    },
  })
}

export function purgeQuizTrashApi() {
  return request<{ ok: boolean; purged_count: number }>(`/palace-quiz-questions/trash/purge`, {
    method: 'POST',
    persistence: {
      resourceKey: `palace-quiz-question:trash-purge`,
      description: '清空题目回收站',
      replayMode: 'manual',
    },
  })
}

export interface QuizPracticeProgressWire {
  items: Array<{
    question_id: number
    palace_id: number | null
    state: Record<string, unknown>
    updated_at: string
  }>
  clears: {
    all: string | null
    palaces: Record<string, string>
    questions: Record<string, string>
  }
}

export function getQuizPracticeProgressApi() {
  return request<QuizPracticeProgressWire>('/quiz/practice-progress')
}

export function saveQuizPracticeProgressApi(items: QuizPracticeProgressWire['items']) {
  return request<QuizPracticeProgressWire>('/quiz/practice-progress', {
    method: 'PUT',
    body: JSON.stringify({ items }),
    persistence: {
      resourceKey: 'quiz-practice-progress',
      description: '保存做题进度',
      replayMode: 'auto',
    },
  })
}

export function clearQuizPracticeProgressApi(payload: {
  all?: boolean
  palace_ids?: number[]
  question_ids?: number[]
  cleared_at?: string
}) {
  return request<QuizPracticeProgressWire>('/quiz/practice-progress/clear', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `quiz-practice-progress:clear:${payload.cleared_at || 'now'}`,
      description: '清除做题进度',
      replayMode: 'auto',
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

export function setPalaceQuizQuestionMarkedApi(questionId: number, marked: boolean) {
  return request<{ item: PalaceQuizQuestion }>(`/palace-quiz-questions/${questionId}/mark`, {
    method: 'POST',
    body: JSON.stringify({ marked }),
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:mark`,
      coalesceKey: `palace-quiz-question:${questionId}:mark`,
      description: marked ? '标记题目' : '取消标记题目',
      // A storage-busy 503 used to sit in the manual queue, so the click looked
      // like a no-op. Auto-replay keeps the latest toggle and retries it.
      replayMode: 'auto',
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

export function requestPalaceQuestionExplainApi(
  questionId: number,
  userQuestion: string,
  aiOptions?: import('@/shared/api/contracts').AiRuntimeOptions,
) {
  return request<PalaceQuestionExplainResult>(
    `/palace-quiz-questions/${questionId}/explain`,
    {
      method: 'POST',
      body: JSON.stringify({ user_question: userQuestion, ai_options: aiOptions }),
      persistence: {
        resourceKey: `palace-quiz-question:${questionId}:explain`,
        description: '生成题目 AI 讲解',
        replayMode: 'manual',
      },
    },
  )
}

export function getQuizReviewQueueApi(palaceId?: number | null) {
  const query = palaceId ? `?palace_id=${palaceId}` : ''
  return request<{ items: PalaceQuizQuestion[] }>(`/palace-quiz-questions/review-queue${query}`)
}

export function reviewQuizQuestionQualityApi(questionId: number) {
  return request<{ review: { passed: boolean; score: number; issues: string[] }; question: PalaceQuizQuestion }>(
    `/palace-quiz-questions/${questionId}/quality-review`,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function transitionQuizQuestionLifecycleApi(
  questionId: number,
  status: 'temporary' | 'candidate' | 'published' | 'rejected',
) {
  return request<{ item: PalaceQuizQuestion }>(`/palace-quiz-questions/${questionId}/lifecycle`, {
    method: 'POST',
    body: JSON.stringify({ status }),
    persistence: {
      resourceKey: `palace-quiz-question:${questionId}:lifecycle:${status}`,
      description: '更新题目审核状态',
      replayMode: 'manual',
    },
  })
}

export function recordQuizAttemptEventApi(data: {
  question_id: number
  palace_id?: number | null
  chapter_id?: number | null
  scene: string
  answer_payload: Record<string, unknown>
  is_correct?: boolean | null
  duration_ms?: number | null
  hint_count?: number
  retry_count?: number
  confidence?: number | null
  ai_score?: number | null
}) {
  return request('/palace-quiz-attempt-events', { method: 'POST', body: JSON.stringify(data) })
}

export function listPalaceQuizNodeBindingsApi(palaceId: number) {
  return request<{ items: QuizNodeBindingEdge[]; item_count: number }>(
    `/palaces/${palaceId}/quiz-node-bindings`,
  )
}

/** Shared-cache key for `listPalaceQuizNodeBindingsApi`. Keep the two in sync. */
export function palaceQuizNodeBindingsCacheKey(palaceId: number) {
  return `palace:${palaceId}:quiz-node-bindings`
}

export function listQuestionNodeBindingsApi(questionId: number) {
  return request<{ question_id: number; items: QuizNodeBindingEdge[]; item_count: number }>(
    `/palace-quiz-questions/${questionId}/node-bindings`,
  )
}

export function searchQuizMindmapNodesApi(query: string, options?: { palaceId?: number; limit?: number }) {
  const params = new URLSearchParams()
  params.set('q', query)
  if (options?.palaceId != null) params.set('palace_id', String(options.palaceId))
  if (options?.limit != null) params.set('limit', String(options.limit))
  return request<{ query: string; items: import('@/shared/api/contracts').QuizMindmapNodeSearchHit[]; item_count: number }>(
    `/quiz-node-search?${params.toString()}`,
  )
}

export function getPalaceQuizQuestionsByIdsApi(questionIds: number[]) {
  return request<{ items: import('@/shared/api/contracts').PalaceQuizQuestion[]; item_count: number }>(
    `/palace-quiz-questions/by-ids`,
    {
      method: 'POST',
      body: JSON.stringify({ question_ids: questionIds }),
    },
  )
}

export function autoBindPalaceQuizNodeBindingsApi(
  palaceId: number,
  data?: { fill_unbound_only?: boolean; max_nodes_per_question?: number },
) {
  invalidateSharedRequest(palaceQuizNodeBindingsCacheKey(palaceId))
  return request<{
    palace_id: number
    created_count: number
    updated_count: number
    removed_count: number
    items: QuizNodeBindingEdge[]
    item_count: number
    proposed_count?: number
  }>(`/palaces/${palaceId}/quiz-node-bindings/auto-bind-text`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-node-bindings:auto-bind-text`,
      description: '文本重合自动绑定知识点',
      replayMode: 'manual',
    },
  })
}

export function mutatePalaceQuizNodeBindingsApi(
  palaceId: number,
  data: {
    add?: Array<{
      question_id: number
      node_uid: string
      reason?: string
      target_palace_id?: number
      palace_id?: number
    }>
    remove?: Array<{
      question_id: number
      node_uid: string
      target_palace_id?: number
      palace_id?: number
    }>
  },
) {
  invalidateSharedRequest(palaceQuizNodeBindingsCacheKey(palaceId))
  return request<{
    palace_id: number
    created_count: number
    updated_count: number
    removed_count: number
    items: QuizNodeBindingEdge[]
    item_count: number
  }>(`/palaces/${palaceId}/quiz-node-bindings/mutate`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:quiz-node-bindings:mutate`,
      description: '手改题库知识点绑定',
      replayMode: 'manual',
    },
  })
}
