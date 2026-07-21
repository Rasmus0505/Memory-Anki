import { getApiToken } from '@/shared/api/apiToken'
import { extractResponseMessage } from '@/shared/api/jsonResponse'
import { API_BASE, request } from '@/shared/api/http'
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
  palaces: Array<{
    id: number
    title: string
    mastered: boolean
    archived: boolean
    review_stage_completed: number
    review_stage_total: number
    next_due_date: string | null
  }>
}


export interface DeleteSubjectImpact {
  ok: false
  requires_reassignment: true
  subject_id: number
  subject_name: string
  palace_count: number
  chapter_count: number
}

export class DeleteSubjectImpactError extends Error {
  impact: DeleteSubjectImpact
  constructor(impact: DeleteSubjectImpact) {
    super(`学科仍关联 ${impact.palace_count} 个宫殿和 ${impact.chapter_count} 个章节`)
    this.name = 'DeleteSubjectImpactError'
    this.impact = impact
  }
}

export interface DeleteChapterImpact {
  ok: false
  requires_force: true
  chapter_count: number
  linked_palace_count: number
  question_count: number
}

export class DeleteChapterImpactError extends Error {
  impact: DeleteChapterImpact

  constructor(impact: DeleteChapterImpact) {
    super('删除章节需要确认影响范围')
    this.name = 'DeleteChapterImpactError'
    this.impact = impact
  }
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

export async function deleteSubjectApi(id: number) {
  const apiToken = getApiToken()
  const response = await fetch(`${API_BASE}/subjects/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { 'X-Memory-Anki-Token': apiToken } : {}),
    },
  })
  const body = await response.text().catch(() => '')
  let payload: unknown
  try { payload = body ? JSON.parse(body) : null } catch { payload = null }
  if (response.status === 409 && payload && typeof payload === 'object' && 'requires_reassignment' in payload) {
    throw new DeleteSubjectImpactError(payload as DeleteSubjectImpact)
  }
  if (!response.ok) throw new Error(extractResponseMessage(response.status, body))
  return payload as { ok: boolean }
}

export function getSubjectTreeApi(id: number) {
  return request<SubjectTree>(`/subjects/${id}/tree`)
}

export function getChapterApi(id: number) {
  return request<ChapterDetailResponse>(`/chapters/${id}`)
}

export async function deleteChapterApi(id: number, options: { force?: boolean } = {}) {
  const search = options.force ? '?force=true' : ''
  const apiToken = getApiToken()
  const response = await fetch(`${API_BASE}/chapters/${id}${search}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { 'X-Memory-Anki-Token': apiToken } : {}),
    },
  })
  const body = await response.text().catch(() => '')
  let payload: unknown
  try {
    payload = body ? JSON.parse(body) : null
  } catch {
    payload = null
  }
  if (
    response.status === 409 &&
    payload &&
    typeof payload === 'object' &&
    'requires_force' in payload &&
    payload.requires_force === true
  ) {
    throw new DeleteChapterImpactError(payload as DeleteChapterImpact)
  }
  if (!response.ok) {
    throw new Error(extractResponseMessage(response.status, body))
  }
  return payload as { ok: boolean }
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
