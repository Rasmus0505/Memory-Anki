import { API_BASE, request } from "@/shared/api/http"
import type {
  ImageTextPreviewResponse,
  MindMapBatchImportPreviewResponse,
  MindMapEditorState,
  MindMapImportPreviewResponse,
  PalaceGroupedListResponse,
  PalaceListItem,
  PalaceReviewPlanResponse,
  PalaceSegmentSummary,
  PalaceVersionDetail,
  PalaceVersionListResponse,
  SessionProgressSnapshot,
} from "@/shared/api/contracts"

export function buildAttachmentUrl(attachmentId: number) {
  return `${API_BASE}/attachments/${attachmentId}`
}

export function getPalacesApi(params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : ""
  return request<PalaceListItem[]>(`/palaces${q}`)
}

export function getPalacesGroupedApi(params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : ""
  return request<PalaceGroupedListResponse>(`/palaces/grouped${q}`)
}

export function getPalaceApi(id: number) {
  return request<any>(`/palaces/${id}`)
}

export function getPalaceReviewPlanApi(id: number) {
  return request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`)
}

export function createPalaceApi(data: any) {
  return request<any>("/palaces", { method: "POST", body: JSON.stringify(data) })
}

export function updatePalaceApi(id: number, data: any) {
  return request<any>(`/palaces/${id}`, { method: "PUT", body: JSON.stringify(data) })
}

export function deletePalaceApi(id: number) {
  return request<any>(`/palaces/${id}`, { method: "DELETE" })
}

export async function uploadAttachmentApi(palaceId: number, file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${API_BASE}/palaces/${palaceId}/upload`, {
    method: "POST",
    body: form,
  })
  return response.json()
}

export function deleteAttachmentApi(id: number) {
  return request<any>(`/attachments/${id}`, { method: "DELETE" })
}

export function getPalaceEditorApi(id: number) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`)
}

export function getPalaceSegmentsApi(id: number) {
  return request<{ items: PalaceSegmentSummary[] }>(`/palaces/${id}/segments`)
}

export function createPalaceSegmentApi(
  palaceId: number,
  data: {
    name?: string
    color?: string
    created_at?: string | null
    node_uids: string[]
  },
) {
  return request<{ item: PalaceSegmentSummary }>(`/palaces/${palaceId}/segments`, {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updatePalaceSegmentApi(
  segmentId: number,
  data: Partial<{
    name: string
    color: string
    created_at: string | null
    sort_order: number
    node_uids: string[]
  }>,
) {
  return request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function updatePalaceSegmentReviewProgressApi(
  segmentId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}/review-progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function updateDefaultSegmentReviewProgressApi(
  palaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: PalaceSegmentSummary | null }>(`/palaces/${palaceId}/default-segment/review-progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function updatePalacePracticeFlagApi(
  palaceId: number,
  data: {
    needs_practice: boolean
  },
) {
  return request<{ item: any }>(`/palaces/${palaceId}/practice-flag`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function deletePalaceSegmentApi(segmentId: number) {
  return request<{ ok: boolean }>(`/palace-segments/${segmentId}`, {
    method: "DELETE",
  })
}

export function getPalaceSegmentApi(segmentId: number) {
  return request<{
    item: PalaceSegmentSummary
    palace: any
    editor_doc: Record<string, unknown> | string | null
  }>(`/palace-segments/${segmentId}`)
}

export function savePalaceEditorApi(id: number, data: Partial<MindMapEditorState>) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify({ ...data, editor_source: "palace_edit" }),
  })
}

export function savePalaceEditorWithOptionsApi(id: number, data: Record<string, unknown>) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function getPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/practice/${id}/progress`)
}

export function getSegmentPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/segment-practice/${id}/progress`)
}

export function savePracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/practice/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function clearPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/practice/${id}/progress`, { method: "DELETE" })
}

export function saveSegmentPracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/segment-practice/${id}/progress`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function clearSegmentPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/segment-practice/${id}/progress`, { method: "DELETE" })
}

export function getPalaceVersionsApi(id: number) {
  return request<PalaceVersionListResponse>(`/palaces/${id}/versions`)
}

export function getPalaceVersionDetailApi(palaceId: number, versionId: number) {
  return request<PalaceVersionDetail>(`/palaces/${palaceId}/versions/${versionId}`)
}

export function restorePalaceVersionApi(id: number, versionId: number) {
  return request<any>(`/palaces/${id}/restore-version`, {
    method: "POST",
    body: JSON.stringify({ version_id: versionId }),
  })
}

export function getPalaceChaptersApi(id: number) {
  return request<any[]>(`/palaces/${id}/chapters`)
}

export function linkPalaceChaptersApi(
  palaceId: number,
  data: { chapter_ids: number[]; primary_chapter_id?: number | null },
) {
  return request<any>(`/palaces/${palaceId}/chapters`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export async function previewMindMapImportApi(file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${API_BASE}/import/preview-mindmap`, {
    method: "POST",
    body: form,
  })
  const data = await response.json()
  return data as MindMapImportPreviewResponse
}

export async function previewImageTextApi(file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${API_BASE}/import/preview-text`, {
    method: "POST",
    body: form,
  })
  const data = await response.json()
  return data as ImageTextPreviewResponse
}

export async function previewMindMapBatchImportApi(
  files: File[],
  options?: {
    structureImageIndex?: number
    fallbackTitle?: string
  },
) {
  const form = new FormData()
  files.forEach((file) => form.append("files", file))
  if (typeof options?.structureImageIndex === "number") {
    form.append("structure_image_index", String(options.structureImageIndex))
  }
  if (options?.fallbackTitle) {
    form.append("fallback_title", options.fallbackTitle)
  }
  const response = await fetch(`${API_BASE}/import/preview-mindmap-batch`, {
    method: "POST",
    body: form,
  })
  const data = await response.json()
  return data as MindMapBatchImportPreviewResponse
}
