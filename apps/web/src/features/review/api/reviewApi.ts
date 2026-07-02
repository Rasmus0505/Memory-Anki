import { request } from '@/shared/api/http'
import { invalidatePalaceCatalogCache } from '@/entities/palace/api'
import {
  consumePrefetchedPromise,
  prefetchPromise,
} from '@/shared/api/promiseWarmupCache'
import {
  clearSessionProgressApi,
  getSessionProgressApi,
  saveSessionProgressApi,
  type SessionProgressPayload,
} from '@/entities/session/api'
import type {
  BatchSegmentReviewSessionResponse,
  BatchSegmentReviewSubmitResponse,
  MiniReviewSessionResponse,
  ReviewQueueResponse,
  ReviewScheduleSummary,
  ReviewSessionSubmitResponse,
  SegmentReviewQueueResponse,
  SegmentReviewScheduleSummary,
} from '@/shared/api/contracts'

async function withPalaceCatalogInvalidation<T>(operation: Promise<T>) {
  const result = await operation
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

export function getSegmentReviewQueueApi() {
  return consumePrefetchedPromise('segment-review:queue', () =>
    request<SegmentReviewQueueResponse>('/segment-review/queue'),
  )
}

export function prefetchSegmentReviewQueueApi() {
  prefetchPromise('segment-review:queue', () =>
    request<SegmentReviewQueueResponse>('/segment-review/queue'),
  )
}

export function getSegmentChapterReviewQueueApi(chapterId: number) {
  return request<SegmentReviewQueueResponse>(`/segment-review/chapter/${chapterId}/queue`)
}

export function getSegmentReviewSessionApi(id: number) {
  return request<
    SegmentReviewScheduleSummary & {
      palace: ReviewScheduleSummary['palace']
      editor_doc: Record<string, unknown> | string | null
    }
  >(`/segment-review/session/${id}`)
}

export function createBatchSegmentReviewSessionApi(data: { segment_ids: number[] }) {
  return request<BatchSegmentReviewSessionResponse>('/segment-review/batch-session', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `segment-review:batch-session:${data.segment_ids.join(',')}`,
      description: 'Create batch segment review session',
      replayMode: 'manual',
    },
  })
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

export function getSegmentReviewSessionProgressApi(id: number) {
  return getSessionProgressApi('segment-review', id)
}

export function saveSegmentReviewSessionProgressApi(id: number, data: SessionProgressPayload) {
  return saveSessionProgressApi('segment-review', id, data, 'Save segment review progress')
}

export function clearSegmentReviewSessionProgressApi(id: number) {
  return clearSessionProgressApi('segment-review', id, 'Clear segment review progress')
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
  return withPalaceCatalogInvalidation(
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

export function submitSegmentReviewSessionApi(
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
  return withPalaceCatalogInvalidation(
    request<ReviewSessionSubmitResponse>(`/segment-review/session/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `segment-review-submit:${id}`,
        description: 'Submit segment review session',
        replayMode: 'auto',
      },
    }),
  )
}

export function getMiniReviewSessionApi(id: number) {
  return request<MiniReviewSessionResponse>(`/mini-review/session/${id}`)
}

export function getMiniReviewSessionProgressApi(id: number) {
  return getSessionProgressApi('mini-review', id)
}

export function saveMiniReviewSessionProgressApi(id: number, data: SessionProgressPayload) {
  return saveSessionProgressApi('mini-review', id, data, 'Save mini review progress')
}

export function clearMiniReviewSessionProgressApi(id: number) {
  return clearSessionProgressApi('mini-review', id)
}

export function submitMiniReviewSessionApi(
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
  return withPalaceCatalogInvalidation(
    request<ReviewSessionSubmitResponse>(`/mini-review/session/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `mini-review-submit:${id}`,
        description: 'Submit mini review session',
        replayMode: 'auto',
      },
    }),
  )
}

export function submitBatchSegmentReviewSessionApi(data: {
  segment_ids: number[]
  duration_seconds?: number
  completion_mode?: 'manual_complete' | 'auto_complete'
  revealed_remaining?: boolean
  red_marked_count?: number
}) {
  return withPalaceCatalogInvalidation(
    request<BatchSegmentReviewSubmitResponse>('/segment-review/batch-session/submit', {
      method: 'POST',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `segment-review-batch-submit:${data.segment_ids.join(',')}`,
        description: 'Submit batch segment review session',
        replayMode: 'auto',
      },
    }),
  )
}
