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
export function startReviewSessionApi(
  palaceId: number,
  data: {
    entry_mode?: 'node' | 'palace'
    branch_uid?: string
    /** Freestyle unit freeze: due UIDs inside the branch unit only. */
    scope_node_uids?: string[]
  } = {},
) {
  return request<ReviewScheduleSummary>(`/review/palaces/${palaceId}/sessions`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
export function getReviewSessionProgressApi(id: string | number) { return request<{ progress: SessionProgressPayload }>(`/review/session/${id}/progress`) }
export function saveReviewSessionProgressApi(id: string | number, data: SessionProgressPayload) {
  return request<{ progress: SessionProgressPayload }>(`/review/session/${id}/progress`, { method: 'PUT', body: JSON.stringify(data) })
}
export function clearReviewSessionProgressApi(id: string | number) { return request<{ ok: boolean }>(`/review/session/${id}/progress`, { method: 'DELETE' }) }
export function getReviewSessionCompletionSummaryApi(id: string | number) { return request<{ item: ReviewCompletionSummary }>(`/review/session/${id}/completion-summary`) }

export function startReviewWaveSessionApi(waveId: string) {
  return request<ReviewScheduleSummary>(`/review/waves/${encodeURIComponent(waveId)}/sessions`, {
    method: 'POST',
    body: '{}',
  })
}

export function listPalaceWavesApi(palaceId: number) {
  return request<{ items: import('@/shared/api/contracts').ReviewWaveSummary[] }>(
    `/review/palaces/${palaceId}/waves`,
  )
}
export function pauseReviewWaveApi(waveId: string) {
  return request<{ item: unknown }>(`/review/waves/${encodeURIComponent(waveId)}/pause`, {
    method: 'POST',
    body: '{}',
  })
}
export function resumeReviewWaveApi(waveId: string, data?: { session_id?: string }) {
  return request<{ item: unknown }>(`/review/waves/${encodeURIComponent(waveId)}/resume`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  })
}
export function mergeNewDueIntoWaveApi(waveId: string, nodeUids?: string[]) {
  return request<{ item: unknown }>(`/review/waves/${encodeURIComponent(waveId)}/merge-new-due`, {
    method: 'POST',
    body: JSON.stringify(nodeUids ? { node_uids: nodeUids } : {}),
  })
}
export function diagnosePalaceCalibrationApi(palaceId: number) {
  return request<{ item: import('@/shared/api/contracts').ReviewCalibrationDiagnose }>(
    `/review/palaces/${palaceId}/calibration/diagnose`,
  )
}
export function previewPalaceCalibrationApi(
  palaceId: number,
  data: {
    operation_id: string
    mode: 'align_wave' | 'baseline'
    scope_kind?: 'palace' | 'branch' | 'nodes'
    scope?: Record<string, unknown>
    baseline_tier?: string
    target_local_date?: string
    palace_revision?: string
  },
) {
  return request<{ item: unknown }>(`/review/palaces/${palaceId}/calibration/preview`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
export function applyPalaceCalibrationApi(
  palaceId: number,
  data: {
    operation_id: string
    mode: 'align_wave' | 'baseline'
    scope_kind?: 'palace' | 'branch' | 'nodes'
    scope?: Record<string, unknown>
    baseline_tier?: string
    target_local_date?: string
    palace_revision?: string
  },
) {
  return request<{ item: unknown }>(`/review/palaces/${palaceId}/calibration/apply`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
export function undoPalaceCalibrationApi(palaceId: number, operationId: string) {
  return request<{ item: unknown }>(
    `/review/palaces/${palaceId}/calibration/${encodeURIComponent(operationId)}/undo`,
    { method: 'POST', body: '{}' },
  )
}

type BulkRateResponse = {
  item: {
    affected_node_count: number
    affected_node_uids: string[]
    skipped_rated_node_count: number
    operation_ids: string[]
    summary: ReviewCompletionSummary
  }
}

/** Settlement one-tap: rate still-unrated frozen-due nodes only (server recomputes the set). */
export function rateUnratedReviewSessionNodesApi(
  id: string | number,
  data: { rating: 1 | 2 | 3 | 4; operation_id: string },
) {
  return request<BulkRateResponse>(`/review/session/${id}/rate-unrated`, {
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

/** Settlement: rate palace due nodes outside this session's frozen scope (user-confirmed). */
export function rateOutOfScopeDueReviewSessionNodesApi(
  id: string | number,
  data: { rating: 1 | 2 | 3 | 4; operation_id: string },
) {
  return request<BulkRateResponse>(`/review/session/${id}/rate-out-of-scope-due`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `review-rate-out-of-scope:${data.operation_id}`,
      description: '一键评分范围外到期节点',
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
