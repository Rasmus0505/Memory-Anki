import { request } from "@/shared/api/http"
import type { MindMapEditorState } from "@/shared/api/contracts"

export function getSubjectsApi() {
  return request<any[]>("/subjects")
}

export function createSubjectApi(data: any) {
  return request<any>("/subjects", { method: "POST", body: JSON.stringify(data) })
}

export function updateSubjectApi(id: number, data: any) {
  return request<any>(`/subjects/${id}`, { method: "PUT", body: JSON.stringify(data) })
}

export function deleteSubjectApi(id: number) {
  return request<any>(`/subjects/${id}`, { method: "DELETE" })
}

export function getSubjectTreeApi(id: number) {
  return request<any>(`/subjects/${id}/tree`)
}

export function getChapterApi(id: number) {
  return request<any>(`/chapters/${id}`)
}

export function getSubjectEditorApi(id: number) {
  return request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`)
}

export function saveSubjectEditorApi(id: number, data: Partial<MindMapEditorState>) {
  return request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}
