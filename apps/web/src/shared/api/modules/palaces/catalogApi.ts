import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  MindMapEditorState,
  PalaceFocusSessionResponse,
  PalaceGroupedListResponse,
  PalaceGroupedSummaryListResponse,
  PalaceListItem,
  PalaceReviewPlanResponse,
  PalaceSubjectShelfResponse,
} from '@/shared/api/contracts'

const warmedPalaceGetCache = new Map<string, Promise<unknown>>()

function buildQueryString(params?: Record<string, string>) {
  return params ? `?${new URLSearchParams(params).toString()}` : ''
}

function consumeWarmedPalaceGet<T>(cacheKey: string, loader: () => Promise<T>) {
  const warmed = warmedPalaceGetCache.get(cacheKey) as Promise<T> | undefined
  if (warmed) {
    warmedPalaceGetCache.delete(cacheKey)
    return warmed
  }
  return loader()
}

function prefetchPalaceGet<T>(cacheKey: string, loader: () => Promise<T>) {
  if (warmedPalaceGetCache.has(cacheKey)) return
  const pending = loader().catch((error) => {
    warmedPalaceGetCache.delete(cacheKey)
    throw error
  })
  warmedPalaceGetCache.set(cacheKey, pending)
  void pending.catch(() => {})
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
  return request<PalaceGroupedListResponse>(`/palaces/grouped${q}`)
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
  return request<any>(`/palaces/${id}`)
}

export function togglePalaceFocusNodeApi(id: number, nodeUid: string, focused?: boolean) {
  return request<{
    ok: boolean
    palace_id: number
    node_uid: string
    focused: boolean
    focus_node_uids: string[]
    focus_count: number
    item: PalaceListItem
  }>(`/palaces/${id}/focus-nodes/${encodeURIComponent(nodeUid)}`, {
    method: 'PUT',
    body: focused === undefined ? undefined : JSON.stringify({ focused }),
    persistence: {
      resourceKey: `palace:${id}:focus-node:${nodeUid}`,
      coalesceKey: `palace:${id}:focus-node:${nodeUid}`,
      description: focused === false ? '取消专项卡标记' : '标记专项卡',
      replayMode: focused === undefined ? 'manual' : 'auto',
    },
  })
}

export function getPalaceReviewPlanApi(id: number) {
  return request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`)
}

export function createPalaceApi(data: any) {
  return request<any>('/palaces', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:create:${data?.title ?? 'untitled'}`,
      description: '创建宫殿',
      replayMode: 'manual',
    },
  })
}

export function updatePalaceApi(id: number, data: any) {
  return request<any>(`/palaces/${id}`, {
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
  return request<any>(`/palaces/${id}`, {
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
  const response = await fetchWithMutationQueue(
    `${API_BASE}/palaces/${palaceId}/upload`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `palace:${palaceId}:attachment:${file.name}`,
      description: `上传附件：${file.name}`,
      replayMode: 'manual',
    },
  )
  return response.json()
}

export function deleteAttachmentApi(id: number) {
  return request<any>(`/attachments/${id}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `attachment:${id}:delete`,
      description: '删除附件',
      replayMode: 'manual',
    },
  })
}

export function getPalaceEditorApi(id: number) {
  return request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`)
}

export function getPalaceFocusSessionApi(id: number) {
  return request<PalaceFocusSessionResponse>(`/palaces/${id}/focus-session`)
}
