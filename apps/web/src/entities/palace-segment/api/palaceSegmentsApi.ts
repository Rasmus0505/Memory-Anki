import { request } from '@/shared/api/http'
import type { PalaceSegmentPracticeResponse, PalaceSegmentSummary } from '@/shared/api/contracts'

export function getPalaceSegmentsApi(id: number) {
  return request<{ items: PalaceSegmentSummary[] }>(`/palaces/${id}/segments`)
}

export function createPalaceSegmentApi(
  palaceId: number,
  data: {
    name?: string
    color?: string
    created_at?: string | null
    node_uids: string[]
  },
) {
  return request<{ item: PalaceSegmentSummary }>(`/palaces/${palaceId}/segments`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:segments:create`,
      description: `创建学习组：${data.name || '未命名学习组'}`,
      replayMode: 'manual',
    },
  })
}

export function updatePalaceSegmentApi(
  segmentId: number,
  data: Partial<{
    name: string
    color: string
    created_at: string | null
    sort_order: number
    node_uids: string[]
  }>,
) {
  return request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace-segment:${segmentId}`,
      coalesceKey: `palace-segment:${segmentId}`,
      description: '保存学习组',
      replayMode: 'auto',
    },
  })
}

export function deletePalaceSegmentApi(segmentId: number) {
  return request<{ ok: boolean }>(`/palace-segments/${segmentId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-segment:${segmentId}:delete`,
      description: '删除学习组',
      replayMode: 'manual',
    },
  })
}

export function getPalaceSegmentApi(segmentId: number) {
  return request<PalaceSegmentPracticeResponse>(`/palace-segments/${segmentId}`)
}
