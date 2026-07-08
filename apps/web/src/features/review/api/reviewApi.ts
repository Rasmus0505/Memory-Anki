import { request } from '@/shared/api/http'
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
  ReviewQueueResponse,
  ReviewScheduleSummary,
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

export function getChapterReviewQueueApi(chapterId: number) {
  return request<ReviewQueueResponse>(`/review/chapter/${chapterId}/queue`)
}

export function getReviewSessionApi(id: number) {
  return request<ReviewScheduleSummary>(`/review/session/${id}`)
}

export function getReviewSessionProgressApi(id: number) {
  return getSessionProgressApi('review', id)
}

export function saveReviewSessionProgressApi(id: number, data: SessionProgressPayload) {
  return saveSessionProgressApi('review', id, data, 'Save review progress')
}

export function clearReviewSessionProgressApi(id: number) {
  return clearSessionProgressApi('review', id, 'Clear review progress')
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
  },
) {
  return withReviewStateInvalidation(
    request<ReviewSessionSubmitResponse>(`/review/session/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `review-submit:${id}`,
        description: 'Submit review session',
        replayMode: 'auto',
      },
    }),
  )
}
