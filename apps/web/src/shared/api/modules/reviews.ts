import { request } from "@/shared/api/http"
import type {
  ReviewQueueResponse,
  ReviewScheduleSummary,
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
  })
}

export function clearReviewSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/review/${id}/progress`, { method: "DELETE" })
}

export function submitReviewSessionApi(
  id: number,
  data: {
    chapter_id?: number
    duration_seconds?: number
    completion_mode?: "manual_complete" | "auto_complete"
    revealed_remaining?: boolean
    red_marked_count?: number
  },
) {
  return request<any>(`/review/session/${id}/submit`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}
