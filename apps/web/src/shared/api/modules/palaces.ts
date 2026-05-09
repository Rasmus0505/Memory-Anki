import { API_BASE, request } from "@/shared/api/http"
import type {
  MindMapEditorState,
  PalaceReviewPlanResponse,
  PalaceVersionDetail,
  PalaceVersionListResponse,
  SessionProgressSnapshot,
} from "@/shared/api/contracts"

export function buildAttachmentUrl(attachmentId: number) {
  return `${API_BASE}/attachments/${attachmentId}`
}

export function getPalacesApi(params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : ""
  return request<any[]>(`/palaces${q}`)
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

export function linkPalaceChaptersApi(palaceId: number, chapterIds: number[]) {
  return request<any>(`/palaces/${palaceId}/chapters`, {
    method: "PUT",
    body: JSON.stringify({ chapter_ids: chapterIds }),
  })
}
