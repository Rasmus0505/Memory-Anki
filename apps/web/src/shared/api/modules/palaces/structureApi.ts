import { request } from '@/shared/api/http'
import type {
  MiniPalaceSummary,
  MiniReviewMode,
  PalaceListItem,
  PalaceSegmentSummary,
  SessionProgressSnapshot,
} from '@/shared/api/contracts'

export function getPalaceSegmentsApi(id: number) {
  return request<{ items: PalaceSegmentSummary[] }>(`/palaces/${id}/segments`)
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
      description: `创建小宫殿：${data.name || '默认命名'}`,
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
      description: '保存小宫殿',
      replayMode: 'auto',
    },
  })
}

export function deleteMiniPalaceApi(miniPalaceId: number) {
  return request<{ ok: boolean }>(`/palace-mini-palaces/${miniPalaceId}`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `palace-mini-palace:${miniPalaceId}:delete`,
      description: '删除小宫殿',
      replayMode: 'manual',
    },
  })
}

export function getPalaceMiniPalaceApi(miniPalaceId: number) {
  return request<{
    item: MiniPalaceSummary
    palace: any
    editor_doc: Record<string, unknown> | string | null
  }>(`/palace-mini-palaces/${miniPalaceId}`)
}

export function updateMiniPalaceReviewProgressApi(
  miniPalaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: MiniPalaceSummary; palace: any }>(
    `/palace-mini-palaces/${miniPalaceId}/review-progress`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `palace-mini-palace:${miniPalaceId}:review-progress`,
        coalesceKey: `palace-mini-palace:${miniPalaceId}:review-progress`,
        description: '保存小宫殿复习进度',
        replayMode: 'auto',
      },
    },
  )
}

export function getMiniPracticeSessionProgressApi(miniPalaceId: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(
    `/sessions/mini-practice/${miniPalaceId}/progress`,
  )
}

export function saveMiniPracticeSessionProgressApi(
  miniPalaceId: number,
  data: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(
    `/sessions/mini-practice/${miniPalaceId}/progress`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
      persistence: {
        resourceKey: `session-progress:mini-practice:${miniPalaceId}`,
        coalesceKey: `session-progress:mini-practice:${miniPalaceId}`,
        description: '保存小宫殿练习进度',
        replayMode: 'auto',
      },
    },
  )
}

export function clearMiniPracticeSessionProgressApi(miniPalaceId: number) {
  return request<{ ok: boolean }>(
    `/sessions/mini-practice/${miniPalaceId}/progress`,
    { method: 'DELETE' },
  )
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
  return request<{ item: PalaceSegmentSummary }>(`/palace-segments/${segmentId}/review-progress`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace-segment:${segmentId}:review-progress`,
      coalesceKey: `palace-segment:${segmentId}:review-progress`,
      description: '保存分块复习进度',
      replayMode: 'auto',
    },
  })
}

export function updateDefaultSegmentReviewProgressApi(
  palaceId: number,
  data: {
    completed_count: number
    completed_review_number?: number | null
    completed_at?: string | null
  },
) {
  return request<{ item: PalaceSegmentSummary | null }>(`/palaces/${palaceId}/default-segment/review-progress`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:default-segment-review-progress`,
      coalesceKey: `palace:${palaceId}:default-segment-review-progress`,
      description: '保存默认分块复习进度',
      replayMode: 'auto',
    },
  })
}

export function updatePalacePracticeFlagApi(
  palaceId: number,
  data: {
    needs_practice: boolean
  },
) {
  return request<{ item: any }>(`/palaces/${palaceId}/practice-flag`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:practice-flag`,
      coalesceKey: `palace:${palaceId}:practice-flag`,
      description: '保存宫殿练习标记',
      replayMode: 'auto',
    },
  })
}

export function updatePalaceMiniReviewModeApi(
  palaceId: number,
  data: {
    mini_review_mode: MiniReviewMode
  },
) {
  return request<{ item: PalaceListItem }>(`/palaces/${palaceId}/mini-review-mode`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:mini-review-mode`,
      coalesceKey: `palace:${palaceId}:mini-review-mode`,
      description: '保存小宫殿复习归属',
      replayMode: 'auto',
    },
  })
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
  return request<{
    item: PalaceSegmentSummary
    palace: any
    editor_doc: Record<string, unknown> | string | null
  }>(`/palace-segments/${segmentId}`)
}
