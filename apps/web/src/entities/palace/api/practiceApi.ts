import { request } from '@/shared/api/http'
import type {
  PalaceVersionDetail,
  PalaceVersionListResponse,
  SessionProgressSnapshot,
} from '@/shared/api/contracts'

export function getPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/practice/${id}/progress`)
}

export function getFocusPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/focus-practice/${id}/progress`)
}

export function getSegmentPracticeSessionProgressApi(id: number) {
  return request<{ progress: SessionProgressSnapshot | null }>(`/sessions/segment-practice/${id}/progress`)
}

export function savePracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/practice/${id}/progress`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `session-progress:practice:${id}`,
      coalesceKey: `session-progress:practice:${id}`,
      description: '保存练习进度',
      replayMode: 'auto',
    },
  })
}

export function saveFocusPracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/focus-practice/${id}/progress`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `session-progress:focus-practice:${id}`,
      coalesceKey: `session-progress:focus-practice:${id}`,
      description: '保存专项练习进度',
      replayMode: 'auto',
    },
  })
}

export function clearPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/practice/${id}/progress`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `session-progress:practice:${id}:clear`,
      description: '清除练习进度',
      replayMode: 'manual',
    },
  })
}

export function clearFocusPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/focus-practice/${id}/progress`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `session-progress:focus-practice:${id}:clear`,
      description: '清除专项练习进度',
      replayMode: 'manual',
    },
  })
}

export function saveSegmentPracticeSessionProgressApi(
  id: number,
  data: {
    reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
    red_node_ids: string[]
    completed: boolean
  },
) {
  return request<{ progress: SessionProgressSnapshot }>(`/sessions/segment-practice/${id}/progress`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `session-progress:segment-practice:${id}`,
      coalesceKey: `session-progress:segment-practice:${id}`,
      description: '保存分块练习进度',
      replayMode: 'auto',
    },
  })
}

export function clearSegmentPracticeSessionProgressApi(id: number) {
  return request<{ ok: boolean }>(`/sessions/segment-practice/${id}/progress`, {
    method: 'DELETE',
    persistence: {
      resourceKey: `session-progress:segment-practice:${id}:clear`,
      description: '清除分块练习进度',
      replayMode: 'manual',
    },
  })
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

export function getPalaceVersionsApi(id: number) {
  return request<PalaceVersionListResponse>(`/palaces/${id}/versions`)
}

export function getPalaceVersionDetailApi(palaceId: number, versionId: number) {
  return request<PalaceVersionDetail>(`/palaces/${palaceId}/versions/${versionId}`)
}

export function restorePalaceVersionApi(id: number, versionId: number) {
  return request<any>(`/palaces/${id}/restore-version`, {
    method: 'POST',
    body: JSON.stringify({ version_id: versionId }),
    persistence: {
      resourceKey: `palace:${id}:restore-version:${versionId}`,
      description: '恢复宫殿版本',
      replayMode: 'manual',
    },
  })
}

export function getPalaceChaptersApi(id: number) {
  return request<any[]>(`/palaces/${id}/chapters`)
}

export function linkPalaceChaptersApi(
  palaceId: number,
  data: { chapter_ids: number[]; primary_chapter_id?: number | null },
) {
  return request<any>(`/palaces/${palaceId}/chapters`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}
