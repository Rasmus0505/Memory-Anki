import { request } from '@/shared/api/http'
import type { MindMapRecallRating } from '@/shared/api/contracts'
import type { PalaceMemoryProjection, PalaceRatingOperationResult } from '@/shared/api/contracts'
import { APP_EVENT_NAMES, emitAppEvent } from '@/shared/events/appEvents'

/**
 * Mid-session node ratings must stay snappy: do not invalidate the palace
 * catalog cache here. Catalog / queue refresh runs on formal completion
 * (and settlement bulk-rate) via reviewApi.
 */
function notifyReviewStateChanged(result: PalaceRatingOperationResult, palaceId: number) {
  emitAppEvent(APP_EVENT_NAMES.reviewStateChanged, {
    palaceId,
    chapterId: null,
    completedStageCount: result.affected_node_count,
    totalStageCount: result.node_count,
    mastered: result.mastered,
    nextReviewAt: result.next_review_at,
  })
}

export function getPalaceMemoryProjectionApi(palaceId: number) {
  return request<{ item: PalaceMemoryProjection }>(`/review/palaces/${palaceId}/memory`)
}

export type RatingConflictPolicy = 'overwrite' | 'skip_direct'

export function ratePalaceNodesApi(
  palaceId: number,
  data: {
    node_uid: string
    rating: MindMapRecallRating
    study_session_id: string
    operation_id: string
    rating_scope?: 'single' | 'subtree'
    conflict_policy?: RatingConflictPolicy
    source_scene?: 'formal_review' | 'practice' | string
    recall_round?: 'first' | 'weak_retry'
    rating_source?: 'manual' | 'inferred'
    inference_confidence?: number | null
    response_ms?: number | null
    hint_count?: number
    retry_count?: number
  },
) {
  return request<{ item: PalaceRatingOperationResult }>(`/review/palaces/${palaceId}/ratings`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `review-rating:${data.operation_id}`,
      description: '保存记忆评分',
      replayMode: 'auto',
    },
  }).then((response) => {
    notifyReviewStateChanged(response.item, palaceId)
    return response
  })
}

export function undoPalaceRatingApi(palaceId: number, operationId: string, studySessionId: string) {
  return request<{ item: PalaceRatingOperationResult }>(`/review/palaces/${palaceId}/ratings/${encodeURIComponent(operationId)}/undo`, {
    method: 'POST',
    body: JSON.stringify({ study_session_id: studySessionId }),
    persistence: {
      resourceKey: `review-rating-undo:${operationId}`,
      description: '撤销记忆评分',
      replayMode: 'auto',
    },
  }).then((response) => {
    notifyReviewStateChanged(response.item, palaceId)
    return response
  })
}
