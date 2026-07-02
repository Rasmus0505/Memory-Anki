import { request } from '@/shared/api/http'
import { invalidatePalaceCatalogCache } from '@/entities/palace/api'
import type { PalaceSegmentPracticeResponse, PalaceSegmentSummary } from '@/shared/api/contracts'

async function withPalaceCatalogInvalidation<T>(operation: Promise<T>) {
  const result = await operation
  invalidatePalaceCatalogCache()
  return result
}

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
      description: `创建分块：${data.name || '未命名分块'}`,
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
      description: '保存分块',
      replayMode: 'auto',
    },
  })
}

export function updatePalaceSegmentReviewProgressApi(
  segmentId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return withPalaceCatalogInvalidation(
    request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}/review-progress`, {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `palace-segment:${segmentId}:review-progress`,
        coalesceKey: `palace-segment:${segmentId}:review-progress`,
        description: '保存分块复习进度',
        replayMode: 'auto',
      },
    }),
  )
}

export function updateDefaultSegmentReviewProgressApi(
  palaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return withPalaceCatalogInvalidation(
    request<{ item: PalaceSegmentSummary | null }>(`/palaces/${palaceId}/default-segment/review-progress`, {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `palace:${palaceId}:default-segment-review-progress`,
        coalesceKey: `palace:${palaceId}:default-segment-review-progress`,
        description: '保存默认分块复习进度',
        replayMode: 'auto',
      },
    }),
  )
}

export function deletePalaceSegmentApi(segmentId: number) {
  return request<{ ok: boolean }>(`/palace-segments/${segmentId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-segment:${segmentId}:delete`,
      description: '删除分块',
      replayMode: 'manual',
    },
  })
}

export function getPalaceSegmentApi(segmentId: number) {
  return request<PalaceSegmentPracticeResponse>(`/palace-segments/${segmentId}`)
}
