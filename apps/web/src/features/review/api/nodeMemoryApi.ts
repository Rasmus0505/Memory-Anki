import { request } from '@/shared/api/http'
import type { MindMapRecallRating } from '@/shared/api/contracts'
import type { PalaceMemoryProjection, PalaceRatingOperationResult } from '@/shared/api/contracts'

export function getPalaceMemoryProjectionApi(palaceId: number) {
  return request<{ item: PalaceMemoryProjection }>(`/review/palaces/${palaceId}/memory`)
}

export function ratePalaceNodesApi(
  palaceId: number,
  data: {
    node_uid: string
    rating: MindMapRecallRating
    study_session_id: string
    operation_id: string
    rating_scope?: 'single' | 'subtree'
    source_scene?: 'formal_review' | 'practice' | string
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
  })
}
