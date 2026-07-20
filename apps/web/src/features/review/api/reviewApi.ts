import { request } from '@/shared/api/http'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'
import { invalidatePalaceCatalogCache } from '@/entities/palace/api'
import { consumePrefetchedPromise, invalidatePrefetchedPromise, prefetchPromise } from '@/shared/api/promiseWarmupCache'
import type { SessionProgressPayload } from '@/entities/session/api'
import type {
  ReviewCompletionSummary,
  ReviewLoadForecastResponse,
  ReviewQueueResponse,
  ReviewScheduleSummary,
  ReviewSessionSubmitResponse,
} from '@/shared/api/contracts'

export function invalidateReviewQueueCache() { invalidatePrefetchedPromise('review:queue') }
async function withReviewStateInvalidation<T>(operation: Promise<T>) {
  const result = await operation
  invalidateReviewQueueCache()
  invalidatePalaceCatalogCache()
  return result
}
export function getReviewQueueApi() { return consumePrefetchedPromise('review:queue', () => request<ReviewQueueResponse>('/review/queue')) }
export function prefetchReviewQueueApi() { prefetchPromise('review:queue', () => request<ReviewQueueResponse>('/review/queue')) }
export function getReviewLoadForecastApi(days = 7) { return request<ReviewLoadForecastResponse>(`/review/load-forecast?days=${days}`) }
export function getChapterReviewQueueApi(chapterId: number) { return request<ReviewQueueResponse>(`/review/chapter/${chapterId}/queue`) }
export function getReviewSessionApi(id: string | number) { return request<ReviewScheduleSummary>(`/review/session/${id}`) }
export function getReviewSessionProgressApi(id: string | number) { return request<{ progress: SessionProgressPayload }>(`/review/session/${id}/progress`) }
export function saveReviewSessionProgressApi(id: string | number, data: SessionProgressPayload) {
  return request<{ progress: SessionProgressPayload }>(`/review/session/${id}/progress`, { method: 'PUT', body: JSON.stringify(data) })
}
export function clearReviewSessionProgressApi(id: string | number) { return request<{ ok: boolean }>(`/review/session/${id}/progress`, { method: 'DELETE' }) }
export function getReviewSessionCompletionSummaryApi(id: string | number) { return request<{ item: ReviewCompletionSummary }>(`/review/session/${id}/completion-summary`) }

/** Settlement one-tap: rate still-unrated frozen-due nodes only (server recomputes the set). */
export function rateUnratedReviewSessionNodesApi(
  id: string | number,
  data: { rating: 1 | 2 | 3 | 4; operation_id: string },
) {
  return request<{
    item: {
      affected_node_count: number
      affected_node_uids: string[]
      skipped_rated_node_count: number
      operation_ids: string[]
      summary: ReviewCompletionSummary
    }
  }>(`/review/session/${id}/rate-unrated`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `review-rate-unrated:${data.operation_id}`,
      description: '一键评分未评分节点',
      replayMode: 'auto',
    },
  }).then((response) => {
    invalidateReviewQueueCache()
    invalidatePalaceCatalogCache()
    return response
  })
}

export function submitReviewSessionApi(
  id: string | number,
  data: { chapter_id?: number; duration_seconds?: number; completion_mode?: 'manual_complete' | 'auto_complete'; revealed_remaining?: boolean; red_marked_count?: number; note?: string },
  options: { mutationId?: string } = {},
) {
  return withReviewStateInvalidation(request<ReviewSessionSubmitResponse>(`/review/session/${id}/submit`, {
    method: 'POST',
    headers: options.mutationId ? { 'X-Memory-Anki-Mutation-ID': options.mutationId } : undefined,
    body: JSON.stringify(data),
    persistence: { resourceKey: `review-submit:${id}`, description: 'Submit review session', replayMode: 'auto' },
  })).then((result) => {
    emitAppEvent(APP_EVENT_NAMES.reviewStateChanged, {
      palaceId: result.palace_id,
      chapterId: result.chapter_id,
      completedStageCount: result.rated_node_count,
      totalStageCount: result.scope_node_count,
      mastered: result.mastery_percent >= 90,
      nextReviewAt: result.next_review_at,
    })
    return result
  })
}
export function getReviewCompletionApi(reviewLogId: number) { return request<ReviewSessionSubmitResponse>(`/review/completions/${reviewLogId}`) }
