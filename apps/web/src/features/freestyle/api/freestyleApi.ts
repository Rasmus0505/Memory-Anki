import { request } from '@/shared/api/http'
import type {
  CreateFreestyleAiExplanationPayload,
  CreateFreestyleQuizAttemptPayload,
  FreestyleAiExplanationRecord,
  FreestyleContentType,
  FreestyleFeedResponse,
  FreestyleHistoryMode,
  FreestyleHistorySummary,
  FreestyleQuizAttemptRecord,
  FreestyleRange,
} from '@/shared/api/contracts'

export function getFreestyleFeedApi(params: {
  range: FreestyleRange
  palaceIds?: number[]
  contentTypes?: FreestyleContentType[]
}) {
  const searchParams = new URLSearchParams()
  searchParams.set('range', params.range)
  if (params.range === 'specific_palaces' && params.palaceIds?.length) {
    searchParams.set('palace_ids', params.palaceIds.join(','))
  }
  if (params.contentTypes?.length) {
    searchParams.set('content_types', params.contentTypes.join(','))
  }
  return request<FreestyleFeedResponse>(`/freestyle/feed?${searchParams.toString()}`)
}

function historySearchParams(params?: {
  limit?: number
  palaceId?: number | null
  questionId?: number | null
  mode?: FreestyleHistoryMode | null
}) {
  const searchParams = new URLSearchParams()
  if (typeof params?.limit === 'number') searchParams.set('limit', String(params.limit))
  if (typeof params?.palaceId === 'number') searchParams.set('palace_id', String(params.palaceId))
  if (typeof params?.questionId === 'number') searchParams.set('question_id', String(params.questionId))
  if (params?.mode) searchParams.set('mode', params.mode)
  const suffix = searchParams.toString()
  return suffix ? `?${suffix}` : ''
}

export function createFreestyleQuestionAttemptApi(data: CreateFreestyleQuizAttemptPayload) {
  return request<{ item: FreestyleQuizAttemptRecord }>('/freestyle/question-attempts', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `freestyle:question-attempt:${data.question_id}:${Date.now()}`,
      description: '保存随心做题记录',
      replayMode: 'manual',
    },
  })
}

export function getFreestyleQuestionAttemptsApi(params?: {
  limit?: number
  palaceId?: number | null
  questionId?: number | null
  mode?: FreestyleHistoryMode | null
}) {
  return request<{ items: FreestyleQuizAttemptRecord[] }>(
    `/freestyle/question-attempts${historySearchParams(params)}`,
  )
}

export function createFreestyleQuestionExplanationApi(
  data: CreateFreestyleAiExplanationPayload,
) {
  return request<{ item: FreestyleAiExplanationRecord }>('/freestyle/question-explanations', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `freestyle:question-explanation:${data.question_id}:${Date.now()}`,
      description: '保存随心 AI 讲解历史',
      replayMode: 'manual',
    },
  })
}

export function getFreestyleQuestionExplanationsApi(params?: {
  limit?: number
  palaceId?: number | null
  questionId?: number | null
}) {
  return request<{ items: FreestyleAiExplanationRecord[] }>(
    `/freestyle/question-explanations${historySearchParams(params)}`,
  )
}

export function getFreestyleHistorySummaryApi() {
  return request<FreestyleHistorySummary>('/freestyle/history-summary')
}
