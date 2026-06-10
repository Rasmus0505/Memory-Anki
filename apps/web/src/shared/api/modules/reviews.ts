import { request } from "@/shared/api/http"
import type {
  BatchSegmentReviewSessionResponse,
  BatchSegmentReviewSubmitResponse,
  ReviewSessionSubmitResponse,
  ReviewQueueResponse,
  ReviewScheduleSummary,
  SegmentReviewQueueResponse,
  SegmentReviewScheduleSummary,
  SessionProgressSnapshot,
} from "@/shared/api/contracts"

export function getReviewQueueApi() {
  return request<ReviewQueueResponse>("/review/queue")
}

export function getChapterReviewQueueApi(chapterId: number) {
  return request<ReviewQueueResponse>(`/review/chapter/${chapterId}/queue`)
}

export function getReviewSessionApi(id: number) {
  return request<ReviewScheduleSummary>(`/review/session/${id}`)
}

export function getSegmentReviewQueueApi() {
  return request<SegmentReviewQueueResponse>("/segment-review/queue")
}

export function getSegmentChapterReviewQueueApi(chapterId: number) {
  return request<SegmentReviewQueueResponse>(`/segment-review/chapter/${chapterId}/queue`)
}

export function getSegmentReviewSessionApi(id: number) {
  return request<SegmentReviewScheduleSummary & {
    palace: ReviewScheduleSummary["palace"]
    editor_doc: Record<string, unknown> | string | null
  }>(`/segment-review/session/${id}`)
}

export function createBatchSegmentReviewSessionApi(data: {
  segment_ids: number[]
}) {
  return request<BatchSegmentReviewSessionResponse>("/segment-review/batch-session", {
    method: "POST",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `segment-review:batch-session:${data.segment_ids.join(',')}`,
      description: '创建多分块复习会话',
      replayMode: 'manual',
    },
  })
}

export function getReviewSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/review/${id}/progress`)
}

export function saveReviewSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/review/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `session-progress:review:${id}`,
      coalesceKey: `session-progress:review:${id}`,
      description: '保存复习进度',
      replayMode: 'auto',
    },
  })
}

export function clearReviewSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/review/${id}/progress`, {
    method: "DELETE",
    persistence: {
      resourceKey: `session-progress:review:${id}:clear`,
      description: '清除复习进度',
      replayMode: 'manual',
    },
  })
}

export function getSegmentReviewSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/segment-review/${id}/progress`)
}

export function saveSegmentReviewSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/segment-review/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `session-progress:segment-review:${id}`,
      coalesceKey: `session-progress:segment-review:${id}`,
      description: '保存分块复习进度',
      replayMode: 'auto',
    },
  })
}

export function clearSegmentReviewSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/segment-review/${id}/progress`, {
    method: "DELETE",
    persistence: {
      resourceKey: `session-progress:segment-review:${id}:clear`,
      description: '清除分块复习进度',
      replayMode: 'manual',
    },
  })
}

export function submitReviewSessionApi(
  id: number,
  data: {
    chapter_id?: number
    duration_seconds?: number
    completion_mode?: "manual_complete" | "auto_complete"
    revealed_remaining?: boolean
    red_marked_count?: number
    target_review_number?: number
    needs_practice?: boolean
  },
) {
  return request<ReviewSessionSubmitResponse>(`/review/session/${id}/submit`, {
    method: "POST",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `review-submit:${id}`,
      description: '提交正式复习',
      replayMode: 'auto',
    },
  })
}

export function submitSegmentReviewSessionApi(
  id: number,
  data: {
    chapter_id?: number
    duration_seconds?: number
    completion_mode?: "manual_complete" | "auto_complete"
    revealed_remaining?: boolean
    red_marked_count?: number
    target_review_number?: number
    needs_practice?: boolean
  },
) {
  return request<ReviewSessionSubmitResponse>(`/segment-review/session/${id}/submit`, {
    method: "POST",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `segment-review-submit:${id}`,
      description: '提交分块复习',
      replayMode: 'auto',
    },
  })
}

export function submitBatchSegmentReviewSessionApi(
  data: {
    segment_ids: number[]
    duration_seconds?: number
    completion_mode?: "manual_complete" | "auto_complete"
    revealed_remaining?: boolean
    red_marked_count?: number
  },
) {
  return request<BatchSegmentReviewSubmitResponse>("/segment-review/batch-session/submit", {
    method: "POST",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `segment-review-batch-submit:${data.segment_ids.join(',')}`,
      description: '提交多分块复习',
      replayMode: 'auto',
    },
  })
}
