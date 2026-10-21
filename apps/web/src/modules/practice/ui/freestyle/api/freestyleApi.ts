import { retryWhileBusy } from '@/shared/api/busyRetry'
import { request } from '@/shared/api/http'
import type {
  CreateFreestyleAiExplanationPayload,
  CreateFreestyleQuizAttemptPayload,
  FreestyleAiExplanationRecord,
  FreestyleContentType,
  FreestyleFeedResponse,
  FreestyleHistoryMode,
  FreestyleHistorySummary,
  FreestyleQueueBuildRequest,
  FreestyleQueueBuildResponse,
  FreestyleQuizAttemptRecord,
  FreestyleRange,
  FreestyleOverlayQuizDropPalacesRequest,
  FreestyleOverlayQuizEnsureRequest,
  FreestyleOverlayQuizProgressRequest,
  FreestyleOverlayQuizSkipPalacesRequest,
  FreestyleOverviewResponse,
  FreestyleRoundActionRequest,
  FreestyleRoundActiveRequest,
  FreestyleRoundRatingRequest,
  FreestyleRoundQuestionRatingsResponse,
  FreestyleRoundStatePayload,
  WrongQuestionsResponse,
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

export function buildFreestyleQueueApi(
  payload: Omit<FreestyleQueueBuildRequest, 'tz'>,
  options?: Pick<RequestInit, 'signal'>,
) {
  const body: FreestyleQueueBuildRequest = {
    ...payload,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  return request<FreestyleQueueBuildResponse>('/freestyle/queue/build', {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
    // Queue construction is a read operation even though its API uses POST.
    persistence: false,
  })
}

export function getFreestyleOverviewApi(params: {
  date: string
  tz: string
  roundId?: string | null
}, options?: Pick<RequestInit, 'signal'>) {
  const searchParams = new URLSearchParams({ date: params.date, tz: params.tz })
  if (params.roundId) searchParams.set('round_id', params.roundId)
  return request<FreestyleOverviewResponse>(`/freestyle/overview?${searchParams.toString()}`, options)
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

export function getFreestyleTomorrowDueApi(options?: Pick<RequestInit, 'signal'>) {
  return request<{ due_tomorrow_count: number }>('/freestyle/tomorrow-due', options)
}

export function getWrongQuestionsApi(limit = 200) {
  return request<WrongQuestionsResponse>(`/palace-quiz-questions/wrong?limit=${limit}`)
}

export function getOrCreateFreestyleRoundApi(
  payload: FreestyleRoundActiveRequest,
  options?: Pick<RequestInit, 'signal'>,
) {
  return request<FreestyleRoundStatePayload>('/freestyle/rounds/active', {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: false,
  })
}

/** Read the workspace's current round. Does not create, replan, or append cards. */
export function getActiveFreestyleRoundApi(
  workspace: string,
  options?: Pick<RequestInit, 'signal'>,
) {
  const params = new URLSearchParams({ workspace })
  return request<FreestyleRoundStatePayload>(`/freestyle/rounds/active?${params.toString()}`, {
    ...options,
    persistence: false,
  })
}

export function getFreestyleRoundApi(roundId: string, options?: Pick<RequestInit, 'signal'>) {
  return request<FreestyleRoundStatePayload>(`/freestyle/rounds/${encodeURIComponent(roundId)}`, {
    ...options,
    persistence: false,
  })
}

/**
 * This round's weakest rating per question, for the 关联题目 rating badge.
 *
 * Read-only: opening a question window must not write the round. `persistence:
 * false` keeps it out of the offline replay queue for the same reason.
 */
export function getFreestyleRoundQuestionRatingsApi(
  roundId: string,
  options?: Pick<RequestInit, 'signal'>,
) {
  return request<FreestyleRoundQuestionRatingsResponse>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/question-ratings`,
    { ...options, persistence: false },
  )
}

export function applyFreestyleRoundActionApi(
  roundId: string,
  payload: FreestyleRoundActionRequest,
) {
  return request<FreestyleRoundStatePayload>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/actions`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: {
        resourceKey: `freestyle-round-action:${payload.operation_id}`,
        description: '同步随心回合计划',
        replayMode: 'auto',
      },
    },
  )
}

export function startFreestyleRoundApi(payload: FreestyleRoundActiveRequest) {
  return request<FreestyleRoundStatePayload>('/freestyle/rounds/start', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `freestyle-round-start:${payload.operation_id}`,
      description: '开始新的随心回合',
      replayMode: 'manual',
    },
  })
}

export function ensureFreestyleOverlayQuizApi(
  roundId: string,
  payload: FreestyleOverlayQuizEnsureRequest,
) {
  const body = JSON.stringify(payload)
  const url = `/freestyle/rounds/${encodeURIComponent(roundId)}/overlay-quiz/ensure`
  // Interactive open: a 503 means another write (usually the scoring glance)
  // still holds SQLite. Queueing it and throwing shows "数据正在写入中" while
  // the learner is waiting to do questions. Retry here, out of the mutation
  // queue, so a stale replay cannot rewrite the pack after they have moved on.
  return retryWhileBusy(
    (headers) => request<FreestyleRoundStatePayload>(url, {
      method: 'POST',
      body,
      headers,
      persistence: false,
    }),
    { delaysMs: [400, 900, 1_800, 3_000] },
  )
}

export function progressFreestyleOverlayQuizApi(
  roundId: string,
  payload: FreestyleOverlayQuizProgressRequest,
) {
  return request<FreestyleRoundStatePayload>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/overlay-quiz/progress`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: {
        resourceKey: `freestyle-overlay-quiz-progress:${payload.operation_id}`,
        description: '保存随心做题进度',
        replayMode: 'auto',
      },
    },
  )
}

export function setFreestyleOverlaySkippedPalacesApi(
  roundId: string,
  payload: FreestyleOverlayQuizSkipPalacesRequest,
) {
  return request<FreestyleRoundStatePayload>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/overlay-quiz/skip-palaces`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: {
        resourceKey: `freestyle-overlay-quiz-skip:${payload.operation_id}`,
        description: payload.skipped ? '从做题删除宫殿' : '恢复宫殿到做题',
        replayMode: 'auto',
      },
    },
  )
}

export function dropFreestyleOverlayQuizPalacesApi(
  roundId: string,
  payload: FreestyleOverlayQuizDropPalacesRequest,
) {
  return request<FreestyleRoundStatePayload>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/overlay-quiz/drop-palaces`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: {
        resourceKey: `freestyle-overlay-quiz-drop:${payload.operation_id}`,
        description: '清除宫殿做题进度',
        replayMode: 'auto',
      },
    },
  )
}

/**
 * Transport cap for one rating POST. The rating outbox (`model/ratingSaveStore`)
 * shows 未保存 earlier (`RATING_SAVE_TIMEOUT_MS`) but keeps listening, so a late
 * success still lands; this cap only ends a request that will never answer.
 */
export const FREESTYLE_RATING_TRANSPORT_TIMEOUT_MS = 45_000

export function rateFreestyleRoundUnitApi(
  roundId: string,
  payload: FreestyleRoundRatingRequest,
) {
  // Not queued or replayed across page loads: the rating outbox owns retries and
  // re-sends the same operation id, which the server de-duplicates.
  return request<{ item: unknown; round: FreestyleRoundStatePayload }>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/ratings`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: false,
      timeoutMs: FREESTYLE_RATING_TRANSPORT_TIMEOUT_MS,
    },
  )
}

/** A 未保存 rating shared through the server: the grade and the request that failed to save. */
export interface FreestyleRatingIntentItem {
  card_id: string
  operation_id: string
  rating: number
  failure: string
  payload: Record<string, unknown>
  updated_at: string | null
}

export interface FreestyleRatingIntentBody {
  operation_id: string
  rating: number
  failure: string
  payload: Record<string, unknown>
}

export function listFreestyleRatingIntentsApi(roundId: string) {
  return request<{ items: FreestyleRatingIntentItem[] }>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/rating-intents`,
    { persistence: false },
  )
}

export function putFreestyleRatingIntentApi(
  roundId: string,
  cardId: string,
  body: FreestyleRatingIntentBody,
) {
  return request<{ item: FreestyleRatingIntentItem }>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/rating-intents/${encodeURIComponent(cardId)}`,
    { method: 'PUT', body: JSON.stringify(body), persistence: false },
  )
}

/** Removes the intent only while it still belongs to this operation id. */
export function clearFreestyleRatingIntentApi(roundId: string, cardId: string, operationId: string) {
  return request<{ cleared: boolean }>(
    `/freestyle/rounds/${encodeURIComponent(roundId)}/rating-intents/${encodeURIComponent(cardId)}?operation_id=${encodeURIComponent(operationId)}`,
    { method: 'DELETE', persistence: false },
  )
}
