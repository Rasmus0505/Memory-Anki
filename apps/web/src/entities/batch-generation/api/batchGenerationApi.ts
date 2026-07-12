import { request, uploadWithFormData } from '@/shared/api/http'

export type OutputMode = 'palace' | 'quiz' | 'both' | 'skip'

export interface BatchSection {
  id: string
  title: string
  level: number
  start_page: number
  end_page: number
  output_mode: OutputMode
  status: string
  operation_id: string
  existing_chapter_id: number | null
  existing_palace_id: number | null
  excluded: boolean
  sort_order: number
  revision: number
  drafts: Array<{ kind: string; content: Record<string, unknown>; quality_score: number | null }>
  issues: Array<{ id: string; kind: string; severity: string; message: string }>
}

export interface BatchBook {
  id: string
  title: string
  textbook_asset_id: string | null
  quiz_asset_id: string | null
  gate_status: string
  representative_section_id: string | null
  sections: BatchSection[]
}

export interface BatchWorkspace {
  id: string
  title: string
  status: string
  assets: Array<{
    id: string
    role: string
    original_name: string
    page_count: number
    text_page_count: number
    scanned_page_count: number
    analysis: { pdf_profile?: string }
  }>
  books: BatchBook[]
}

export function createBatchWorkspace(title: string) {
  return request<BatchWorkspace>('/batch-generation/workspaces', {
    method: 'POST',
    body: JSON.stringify({ title }),
    persistence: { resourceKey: `batch:create:${title}`, description: '创建整书批量工作区' },
  })
}

export function getBatchWorkspace(id: string) {
  return request<BatchWorkspace>(`/batch-generation/workspaces/${id}`)
}

export function uploadBatchPdfs(id: string, role: 'textbook' | 'quiz', files: File[]) {
  const formData = new FormData()
  formData.append('role', role)
  files.forEach((file) => formData.append('files', file))
  return uploadWithFormData<BatchWorkspace>(`/batch-generation/workspaces/${id}/assets`, formData, {
    resourceKey: `batch:upload:${id}:${role}`,
    description: '上传批量 PDF',
  })
}

export function updateBatchSection(section: BatchSection, changes: Partial<Pick<BatchSection, 'title' | 'start_page' | 'end_page' | 'output_mode' | 'excluded' | 'existing_chapter_id' | 'existing_palace_id'>>) {
  return request<BatchSection>(`/batch-generation/sections/${section.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ expected_revision: section.revision, ...changes }),
    persistence: { resourceKey: `batch:section:${section.id}`, description: '更新批量章节计划', coalesceKey: `batch:section:${section.id}` },
  })
}

export function confirmBatchOutline(bookId: string, representativeSectionId: string) {
  return request<BatchWorkspace>(`/batch-generation/books/${bookId}/confirm-outline`, {
    method: 'POST',
    body: JSON.stringify({ representative_section_id: representativeSectionId }),
    persistence: { resourceKey: `batch:outline:${bookId}`, description: '确认目录和代表节' },
  })
}

export function previewBatchPrompt(sectionId: string, payload: { kind: 'palace' | 'quiz'; model: string; system_prompt: string; user_prompt: string }) {
  return request<Record<string, unknown>>(`/batch-generation/sections/${sectionId}/prompt-preview`, { method: 'POST', body: JSON.stringify(payload), persistence: false })
}

export function saveBatchDraft(section: BatchSection, kind: 'palace' | 'quiz', content: Record<string, unknown>) {
  return request<BatchSection>(`/batch-generation/sections/${section.id}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ kind, operation_id: section.operation_id, content }),
    persistence: { resourceKey: `batch:draft:${section.id}:${kind}`, description: '保存批量生成草稿', coalesceKey: `batch:draft:${section.id}:${kind}` },
  })
}

export function buildBatchPublishPlan(workspaceId: string) {
  return request<{ id: string; status: string; actions: Array<Record<string, unknown>>; conflicts: Array<Record<string, unknown>> }>(`/batch-generation/workspaces/${workspaceId}/publish-plan`, {
    method: 'POST',
    persistence: { resourceKey: `batch:publish-plan:${workspaceId}`, description: '生成批量发布清单' },
  })
}
