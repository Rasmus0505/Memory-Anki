import { request } from '@/shared/api/http'
import type {
  BilinkCountsResponse,
  BilinkItem,
  BilinkListResponse,
  BilinkNodeContext,
  BilinkSearchResponse,
} from '@/shared/api/contracts'

export function searchBilinkNodesApi(query: string, limit = 20) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  })
  return request<BilinkSearchResponse>(`/search/nodes?${params.toString()}`)
}

export function createBilinkApi(data: {
  source_palace_id: number
  target_palace_id: number
  src_uid?: string | null
  tgt_uid?: string | null
  text?: string
}) {
  return request<{ item: BilinkItem }>('/bilinks', {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `bilink:create:${data.source_palace_id}:${data.src_uid ?? ''}:${data.target_palace_id}:${data.tgt_uid ?? ''}`,
      description: '创建双链',
      replayMode: 'manual',
    },
  })
}

export function getBilinksApi(palaceId: number) {
  return request<BilinkListResponse>(`/bilinks?palace_id=${palaceId}`)
}

export function getBilinkCountsApi(palaceId: number) {
  return request<BilinkCountsResponse>(`/bilinks/counts?palace_id=${palaceId}`)
}

export function deleteBilinkApi(bilinkId: number) {
  return request<{ ok: boolean; error?: string }>(`/bilinks/${bilinkId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `bilink:${bilinkId}:delete`,
      description: '删除双链',
      replayMode: 'manual',
    },
  })
}

export function getBilinkNodeContextApi(palaceId: number, nodeUid?: string | null) {
  const params = new URLSearchParams({
    palace_id: String(palaceId),
  })
  if (nodeUid) {
    params.set('node_uid', nodeUid)
  }
  return request<BilinkNodeContext | { error: string }>(`/nodes/context?${params.toString()}`)
}
