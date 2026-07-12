import { request } from '@/shared/api/http'
import { invalidatePalaceCatalogCache } from '@/entities/palace/api'
import type { MiniPalacePracticeResponse, MiniPalaceSummary, PalaceEditorMeta } from '@/shared/api/contracts'

async function withPalaceCatalogInvalidation<T>(operation: Promise<T>) {
  const result = await operation
  invalidatePalaceCatalogCache()
  return result
}

export function getMiniPalacesApi(id: number) {
  return request<{ items: MiniPalaceSummary[] }>(`/palaces/${id}/mini-palaces`)
}

export function createMiniPalaceApi(
  palaceId: number,
  data: {
    name?: string
    node_uids: string[]
  },
) {
  return request<{ item: MiniPalaceSummary }>(`/palaces/${palaceId}/mini-palaces`, {
    method: 'POST',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:mini-palaces:create`,
      description: `创建迷你宫殿训练：${data.name || '默认命名'}`,
      replayMode: 'manual',
    },
  })
}

export function updateMiniPalaceApi(
  miniPalaceId: number,
  data: Partial<{
    name: string
    node_uids: string[]
    sort_order: number
  }>,
) {
  return request<{ item: MiniPalaceSummary }>(`/palace-mini-palaces/${miniPalaceId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace-mini-palace:${miniPalaceId}`,
      coalesceKey: `palace-mini-palace:${miniPalaceId}`,
      description: '保存迷你宫殿训练',
      replayMode: 'auto',
    },
  })
}

export function deleteMiniPalaceApi(miniPalaceId: number) {
  return request<{ ok: boolean }>(`/palace-mini-palaces/${miniPalaceId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-mini-palace:${miniPalaceId}:delete`,
      description: '删除迷你宫殿训练',
      replayMode: 'manual',
    },
  })
}

export function getPalaceMiniPalaceApi(miniPalaceId: number) {
  return request<MiniPalacePracticeResponse>(`/palace-mini-palaces/${miniPalaceId}`)
}

export function updateMiniPalaceReviewProgressApi(
  miniPalaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return withPalaceCatalogInvalidation(
    request<{ item: MiniPalaceSummary; palace: PalaceEditorMeta }>(
      `/palace-mini-palaces/${miniPalaceId}/review-progress`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
        persistence: {
          resourceKey: `palace-mini-palace:${miniPalaceId}:review-progress`,
          coalesceKey: `palace-mini-palace:${miniPalaceId}:review-progress`,
          description: '保存迷你宫殿训练复习进度',
          replayMode: 'auto',
        },
      },
    ),
  )
}
