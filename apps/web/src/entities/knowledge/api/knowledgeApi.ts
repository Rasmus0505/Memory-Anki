import { request } from '@/shared/api/http'
import type { MindMapEditorState } from '@/shared/api/contracts'

export interface SubjectSummary {
  id: number
  name: string
  color?: string
  sort_order?: number
}

export interface ChapterSummary {
  id: number
  name: string
  parent_id?: number | null
  subject_id?: number | null
  children?: ChapterSummary[]
}

export interface SubjectTree {
  subject?: SubjectSummary
  chapters?: ChapterSummary[]
}

export interface ChapterDetailResponse {
  chapter: {
    id: number
    name: string
    notes: string
    children: Array<{ id: number; name: string }>
    breadcrumbs: Array<{ id: number; name: string }>
  }
  palaces: Array<{ id: number; title: string }>
}

export function getSubjectsApi() {
  return request<SubjectSummary[]>('/subjects')
}

export function createSubjectApi(data: unknown) {
  const name =
    data && typeof data === 'object' && 'name' in data
      ? String((data as { name?: unknown }).name ?? 'untitled')
      : 'untitled'
  return request<SubjectSummary>('/subjects', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `subject:create:${name}`,
      description: '创建学科',
      replayMode: 'manual',
    },
  })
}

export function updateSubjectApi(id: number, data: unknown) {
  return request<SubjectSummary>(`/subjects/${id}`, {
    method: 'PUT',
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
  return request<{ ok: boolean }>(`/subjects/${id}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `subject:${id}:delete`,
      description: '删除学科',
      replayMode: 'manual',
    },
  })
}

export function getSubjectTreeApi(id: number) {
  return request<SubjectTree>(`/subjects/${id}/tree`)
}

export function getChapterApi(id: number) {
  return request<ChapterDetailResponse>(`/chapters/${id}`)
}

export function getSubjectEditorApi(id: number) {
  return request<{ subject: SubjectSummary } & MindMapEditorState>(`/subjects/${id}/editor`)
}

export function saveSubjectEditorApi(id: number, data: Partial<MindMapEditorState>) {
  return request<{ subject: SubjectSummary } & MindMapEditorState>(`/subjects/${id}/editor`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `subject:${id}:editor`,
      coalesceKey: `subject:${id}:editor`,
      description: '保存知识脑图',
      replayMode: 'auto',
    },
  })
}
