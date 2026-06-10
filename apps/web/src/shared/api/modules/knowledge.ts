import { fetchWithMutationQueue, request } from "@/shared/api/http"
import type {
  MindMapEditorState,
  PdfPageSummary,
  SubjectDocumentSummary,
} from "@/shared/api/contracts"

export function getSubjectsApi() {
  return request<any[]>("/subjects")
}

export function createSubjectApi(data: any) {
  return request<any>("/subjects", {
    method: "POST",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `subject:create:${data?.name ?? 'untitled'}`,
      description: '创建学科',
      replayMode: 'manual',
    },
  })
}

export function updateSubjectApi(id: number, data: any) {
  return request<any>(`/subjects/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `subject:${id}:meta`,
      coalesceKey: `subject:${id}:meta`,
      description: '保存学科信息',
      replayMode: 'auto',
    },
  })
}

export function deleteSubjectApi(id: number) {
  return request<any>(`/subjects/${id}`, {
    method: "DELETE",
    persistence: {
      resourceKey: `subject:${id}:delete`,
      description: '删除学科',
      replayMode: 'manual',
    },
  })
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
    persistence: {
      resourceKey: `subject:${id}:editor`,
      coalesceKey: `subject:${id}:editor`,
      description: '保存知识脑图',
      replayMode: 'auto',
    },
  })
}

export async function uploadSubjectDocumentApi(subjectId: number, file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetchWithMutationQueue(
    `/api/v1/subjects/${subjectId}/documents`,
    {
      method: "POST",
      body: form,
    },
    {
      resourceKey: `subject:${subjectId}:document:${file.name}`,
      description: `上传学科 PDF：${file.name}`,
      replayMode: 'manual',
    },
  )
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`)
  }
  return data as SubjectDocumentSummary
}

export function getSubjectDocumentsApi(subjectId: number) {
  return request<{ items: SubjectDocumentSummary[] }>(`/subjects/${subjectId}/documents`)
}

export function deleteSubjectDocumentApi(subjectId: number, documentId: number) {
  return request<{ ok: boolean }>(`/subjects/${subjectId}/documents/${documentId}`, {
    method: "DELETE",
    persistence: {
      resourceKey: `subject:${subjectId}:document:${documentId}:delete`,
      description: '删除学科 PDF',
      replayMode: 'manual',
    },
  })
}

export function getSubjectDocumentPagesApi(subjectId: number, documentId: number) {
  return request<{ page_count: number; pages: PdfPageSummary[] }>(
    `/subjects/${subjectId}/documents/${documentId}/pages`,
  )
}
