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
  const doc = data.editor_doc
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const root = 'root' in doc && typeof doc.root === 'object' && doc.root ? doc.root : null
    const rootChildren = root && Array.isArray((root as { children?: unknown[] }).children)
      ? (root as { children: unknown[] }).children.length
      : null
    const topChildren = Array.isArray((doc as { children?: unknown[] }).children)
      ? (doc as { children: unknown[] }).children.length
      : null
    console.log('[knowledge.saveSubjectEditorApi]', {
      subjectId: id,
      docKeys: Object.keys(doc),
      topChildren,
      rootChildren,
      lang: data.lang,
    })
  } else {
    console.log('[knowledge.saveSubjectEditorApi]', {
      subjectId: id,
      docType: typeof doc,
      lang: data.lang,
    })
  }
  return request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}
