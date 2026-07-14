import { request } from '@/shared/api/http'
import type {
  ReviewStageAdjustmentPayload,
  ReviewStageAdjustmentPreviewPayload,
  ReviewStageAdjustmentResponse,
} from '@/shared/api/contracts'

export function previewReviewStageAdjustmentApi(
  palaceId: number,
  payload: ReviewStageAdjustmentPreviewPayload,
) {
  return request<ReviewStageAdjustmentResponse>(
    `/review/palaces/${palaceId}/stage-adjustment/preview`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function applyReviewStageAdjustmentApi(
  palaceId: number,
  payload: ReviewStageAdjustmentPayload,
) {
  return request<ReviewStageAdjustmentResponse>(
    `/review/palaces/${palaceId}/stage-adjustment`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      persistence: {
        resourceKey: `palace:${palaceId}:review-stage-adjustment`,
        description: '手动调整宫殿复习进度',
        replayMode: 'manual',
      },
    },
  )
}
