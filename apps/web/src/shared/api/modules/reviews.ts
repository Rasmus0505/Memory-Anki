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


export function getMiniReviewSessionApi(id: number) {
  return request<{
    id: number
    palace_mini_palace_id: number
    palace_id: number
    scheduled_date: string
    interval_days: number
    algorithm_used: string
    completed: boolean
    completed_at: string | null
    review_number: number
    review_type: string
    mini_palace: MiniPalaceSummary
    estimated_review_seconds: number
    palace: any
    editor_doc: Record<string, unknown> | string | null
  }>(`/mini-review/session/${id}`)
}

export function getMiniReviewSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(
    `/sessions/mini-review/${id}/progress`,
  )
}

export function saveMiniReviewSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(
    `/sessions/mini-review/${id}/progress`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `session-progress:mini-review:${id}`,
        coalesceKey: `session-progress:mini-review:${id}`,
        description: '保存小宫殿复习进度',
        replayMode: 'auto',
      },
    },
  )
}

export function clearMiniReviewSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/mini-review/${id}/progress`, {
    method: 'DELETE',
  })
}

export function submitMiniReviewSessionApi(
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
  return request<ReviewSessionSubmitResponse>(`/mini-review/session/${id}/submit`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `mini-review-submit:${id}`,
      description: '提交小宫殿正式复习',
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
