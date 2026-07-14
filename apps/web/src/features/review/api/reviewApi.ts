import { request } from '@/shared/api/http'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'
import { invalidatePalaceCatalogCache } from '@/entities/palace/api'
import {
  consumePrefetchedPromise,
  invalidatePrefetchedPromise,
  prefetchPromise,
} from '@/shared/api/promiseWarmupCache'
import {
  clearSessionProgressApi,
  getSessionProgressApi,
  saveSessionProgressApi,
  type SessionProgressPayload,
} from '@/entities/session/api'
import type {
  ReviewLoadForecastResponse,
  ReviewQueueResponse,
  ReviewScheduleSummary,
  SpreadOverdueResponse,
  ReviewStageProgressHealthResponse,
  ReviewStageProgressRepairResponse,
  ReviewSessionSubmitResponse,
} from '@/shared/api/contracts'

export function invalidateReviewQueueCache() {
  invalidatePrefetchedPromise('review:queue')
}

async function withReviewStateInvalidation<T>(operation: Promise<T>) {
  const result = await operation
  invalidateReviewQueueCache()
  invalidatePalaceCatalogCache()
  return result
}

export function getReviewQueueApi() {
  return consumePrefetchedPromise('review:queue', () =>
    request<ReviewQueueResponse>('/review/queue'),
  )
}

export function prefetchReviewQueueApi() {
  prefetchPromise('review:queue', () => request<ReviewQueueResponse>('/review/queue'))
}

export function getReviewLoadForecastApi(days = 7) {
  return request<ReviewLoadForecastResponse>(`/review/load-forecast?days=${days}`)
}

export function getChapterReviewQueueApi(chapterId: number) {
  return request<ReviewQueueResponse>(`/review/chapter/${chapterId}/queue`)
}

export function getReviewSessionApi(id: number) {
  return request<ReviewScheduleSummary>(`/review/session/${id}`)
}

export function getReviewSessionProgressApi(id: number) {
  return getSessionProgressApi('review', id)
}

export function previewSpreadOverdueApi(days = 7) {
  return request<SpreadOverdueResponse>('/review/spread-overdue', {
    method: 'POST',
    body: JSON.stringify({ days, dry_run: true }),
    persistence: false,
  })
}

export function spreadOverdueApi(days = 7) {
  return withReviewStateInvalidation(
    request<SpreadOverdueResponse>('/review/spread-overdue', {
      method: 'POST',
      body: JSON.stringify({ days }),
      persistence: {
        resourceKey: 'review:spread-overdue',
        description: '平滑逾期复习',
        replayMode: 'manual',
      },
    }),
  )
}

export function undoSpreadOverdueApi() {
  return withReviewStateInvalidation(
    request<{ ok: boolean; restored: number }>('/review/spread-overdue/undo', {
      method: 'POST',
      body: JSON.stringify({}),
      persistence: {
        resourceKey: 'review:spread-overdue:undo',
        description: '撤销逾期平滑',
        replayMode: 'manual',
      },
    }),
  )
}

export function saveReviewSessionProgressApi(id: number, data: SessionProgressPayload) {
  return saveSessionProgressApi('review', id, data, 'Save review progress')
}

export function clearReviewSessionProgressApi(id: number) {
  return clearSessionProgressApi('review', id, 'Clear review progress')
}

export function getReviewStageProgressHealthApi() {
  return request<ReviewStageProgressHealthResponse>('/review/stage-progress-health')
}

export function previewReviewStageProgressRepairApi() {
  return request<ReviewStageProgressRepairResponse>('/review/repair-stage-progress', {
    method: 'POST',
    body: JSON.stringify({ dry_run: true }),
    persistence: false,
  })
}

export function repairReviewStageProgressApi() {
  return withReviewStateInvalidation(
    request<ReviewStageProgressRepairResponse>('/review/repair-stage-progress', {
      method: 'POST',
      body: JSON.stringify({}),
      persistence: {
        resourceKey: 'review:repair-stage-progress',
        description: '修复历史宫殿复习进度',
        replayMode: 'manual',
      },
    }),
  )
}

export function submitReviewSessionApi(
  id: number,
  data: {
    chapter_id?: number
    duration_seconds?: number
    completion_mode?: 'manual_complete' | 'auto_complete'
    revealed_remaining?: boolean
    red_marked_count?: number
    target_review_number?: number
    needs_practice?: boolean
    note?: string
  },
  options: { mutationId?: string } = {},
) {
  return withReviewStateInvalidation(
    request<ReviewSessionSubmitResponse>(`/review/session/${id}/submit`, {
      method: 'POST',
      headers: options.mutationId ? { 'X-Memory-Anki-Mutation-ID': options.mutationId } : undefined,
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `review-submit:${id}`,
        description: 'Submit review session',
        replayMode: 'auto',
      },
    }),
  ).then((result) => {
    emitAppEvent(APP_EVENT_NAMES.reviewStateChanged, {
      palaceId: result.palace_id,
      chapterId: result.chapter_id,
      completedStageCount: result.completed_stage_count,
      totalStageCount: result.total_stage_count,
      mastered: result.mastered,
      nextReviewAt: result.next_review_at,
    })
    return result
  })
}

export function getReviewCompletionApi(reviewLogId: number) {
  return request<ReviewSessionSubmitResponse>(`/review/completions/${reviewLogId}`)
}
