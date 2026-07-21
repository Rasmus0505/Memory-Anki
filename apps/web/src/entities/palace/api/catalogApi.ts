import { API_BASE, request, uploadWithFormData } from '@/shared/api/http'
import type {
  PalaceEditorMeta,
  PalaceEditorResponse,
  PalaceGroupedListResponse,
  PalaceGroupedSummaryListResponse,
  PalaceListItem,
  PalaceReviewPlanResponse,
  PalaceSubjectShelfResponse,
  PalaceTemplateSummary,
} from '@/shared/api/contracts'
import {
  clearPrefetchedPromisesByPrefix,
  consumePrefetchedPromise,
  prefetchPromise,
} from '@/shared/api/promiseWarmupCache'
import { emitAppEvent } from '@/shared/events/appEvents'
import { PALACE_CATALOG_INVALIDATED_EVENT } from './catalogQuery'

export { PALACE_CATALOG_INVALIDATED_EVENT } from './catalogQuery'

export type PalaceMutationPayload = Partial<
  Pick<PalaceEditorMeta, 'title' | 'description' | 'created_at' | 'primary_chapter_id'>
> & {
  subject_ids?: number[]
  pegs?: Array<{ name?: string; content?: string; children?: unknown[] }>
}

export interface DeleteResponse {
  ok: boolean
}

export interface PalaceAttachmentUploadResponse {
  id: number
  filename: string
  original_name: string
}

function buildQueryString(params?: Record<string, string>) {
  return params ? `?${new URLSearchParams(params).toString()}` : ''
}

function consumeWarmedPalaceGet<T>(cacheKey: string, loader: () => Promise<T>) {
  return consumePrefetchedPromise(`palace:${cacheKey}`, loader)
}

function prefetchPalaceGet<T>(cacheKey: string, loader: () => Promise<T>) {
  prefetchPromise(`palace:${cacheKey}`, loader)
}

export function buildAttachmentUrl(attachmentId: number) {
  return `${API_BASE}/attachments/${attachmentId}`
}

export function getPalacesApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  return request<PalaceListItem[]>(`/palaces${q}`)
}

export function getPalacesGroupedApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  const cacheKey = `grouped:${q}`
  return consumeWarmedPalaceGet(cacheKey, () =>
    request<PalaceGroupedListResponse>(`/palaces/grouped${q}`),
  )
}

export function invalidatePalaceCatalogCache() {
  clearPrefetchedPromisesByPrefix('palace:')
  emitAppEvent(PALACE_CATALOG_INVALIDATED_EVENT)
}

export function prefetchPalacesGroupedApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  const cacheKey = `grouped:${q}`
  prefetchPalaceGet(cacheKey, () =>
    request<PalaceGroupedListResponse>(`/palaces/grouped${q}`),
  )
}

export function getPalacesGroupedSummaryApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  const cacheKey = `grouped-summary:${q}`
  return consumeWarmedPalaceGet(cacheKey, () =>
    request<PalaceGroupedSummaryListResponse>(`/palaces/grouped-summary${q}`),
  )
}

export function prefetchPalacesGroupedSummaryApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  const cacheKey = `grouped-summary:${q}`
  prefetchPalaceGet(cacheKey, () =>
    request<PalaceGroupedSummaryListResponse>(`/palaces/grouped-summary${q}`),
  )
}

export function getPalaceSubjectShelfApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  const cacheKey = `subjects:${q}`
  return consumeWarmedPalaceGet(cacheKey, () =>
    request<PalaceSubjectShelfResponse>(`/palaces/subjects${q}`),
  )
}

export function prefetchPalaceSubjectShelfApi(params?: Record<string, string>) {
  const q = buildQueryString(params)
  const cacheKey = `subjects:${q}`
  prefetchPalaceGet(cacheKey, () =>
    request<PalaceSubjectShelfResponse>(`/palaces/subjects${q}`),
  )
}

export function getPalaceApi(id: number) {
  return request<PalaceEditorMeta>(`/palaces/${id}`)
}

export function getPalaceReviewPlanApi(id: number) {
  return request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`)
}

export function createPalaceApi(data: PalaceMutationPayload) {
  return request<PalaceEditorMeta>('/palaces', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:create:${data?.title ?? 'untitled'}`,
      description: '创建宫殿',
      replayMode: 'manual',
    },
  })
}

export function updatePalaceApi(id: number, data: PalaceMutationPayload) {
  return request<PalaceEditorMeta>(`/palaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${id}:meta`,
      coalesceKey: `palace:${id}:meta`,
      description: '保存宫殿信息',
      replayMode: 'auto',
    },
  })
}

export function deletePalaceApi(id: number) {
  return request<DeleteResponse>(`/palaces/${id}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace:${id}:delete`,
      description: '删除宫殿',
      replayMode: 'manual',
    },
  })
}

export async function uploadAttachmentApi(palaceId: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  return uploadWithFormData<PalaceAttachmentUploadResponse>(`/palaces/${palaceId}/upload`, form, {
    resourceKey: `palace:${palaceId}:attachment:${file.name}`,
    description: `上传附件：${file.name}`,
  })
}

export function deleteAttachmentApi(id: number) {
  return request<DeleteResponse>(`/attachments/${id}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `attachment:${id}:delete`,
      description: '删除附件',
      replayMode: 'manual',
    },
  })
}

export function getPalaceEditorApi(id: number) {
  return request<PalaceEditorResponse>(`/palaces/${id}/editor`)
}

export function listPalaceTemplatesApi() {
  return request<{ items: PalaceTemplateSummary[] }>('/palace-templates')
}

export function createPalaceTemplateApi(data: { palace_id: number; name: string; description?: string }) {
  return request<{ item: PalaceTemplateSummary }>('/palace-templates', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: 'palace-template:create',
      description: '存为宫殿模板',
      replayMode: 'manual',
    },
  })
}

export function deletePalaceTemplateApi(id: number) {
  return request<{ ok: boolean }>(`/palace-templates/${id}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-template:delete:${id}`,
      description: '删除宫殿模板',
      replayMode: 'manual',
    },
  })
}

export function instantiatePalaceTemplateApi(id: number, title: string) {
  return request<{ id: number }>(`/palace-templates/${id}/instantiate`, {
    method: 'POST',
    body: JSON.stringify({ title }),
    persistence: {
      resourceKey: 'palace-template:instantiate',
      description: '从模板创建宫殿',
      replayMode: 'manual',
    },
  })
}
