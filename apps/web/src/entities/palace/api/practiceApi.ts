import { request } from '@/shared/api/http'
import {
  clearSessionProgressApi,
  getSessionProgressApi,
  saveSessionProgressApi,
  type SessionProgressPayload,
} from '@/entities/session/api'
import type {
  ChapterSummary,
  PalaceEditorMeta,
  PalaceVersionDetail,
  PalaceVersionListResponse,
} from '@/shared/api/contracts'

export function getPracticeSessionProgressApi(id: number) {
  return getSessionProgressApi('practice', id)
}

export function getSegmentPracticeSessionProgressApi(id: number) {
  return getSessionProgressApi('segment-practice', id)
}

export function savePracticeSessionProgressApi(id: number, data: SessionProgressPayload) {
  return saveSessionProgressApi('practice', id, data, 'Save practice progress')
}

export function clearPracticeSessionProgressApi(id: number) {
  return clearSessionProgressApi('practice', id, 'Clear practice progress')
}

export function saveSegmentPracticeSessionProgressApi(id: number, data: SessionProgressPayload) {
  return saveSessionProgressApi('segment-practice', id, data, 'Save segment practice progress')
}

export function clearSegmentPracticeSessionProgressApi(id: number) {
  return clearSessionProgressApi('segment-practice', id, 'Clear segment practice progress')
}

export function getMiniPracticeSessionProgressApi(miniPalaceId: number) {
  return getSessionProgressApi('mini-practice', miniPalaceId)
}

export function saveMiniPracticeSessionProgressApi(
  miniPalaceId: number,
  data: SessionProgressPayload,
) {
  return saveSessionProgressApi(
    'mini-practice',
    miniPalaceId,
    data,
    'Save mini practice progress',
  )
}

export function clearMiniPracticeSessionProgressApi(miniPalaceId: number) {
  return clearSessionProgressApi('mini-practice', miniPalaceId)
}

export function getPalaceVersionsApi(id: number) {
  return request<PalaceVersionListResponse>(`/palaces/${id}/versions`)
}

export function getPalaceVersionDetailApi(palaceId: number, versionId: number) {
  return request<PalaceVersionDetail>(`/palaces/${palaceId}/versions/${versionId}`)
}

export function restorePalaceVersionApi(id: number, versionId: number) {
  return request<PalaceEditorMeta>(`/palaces/${id}/restore-version`, {
    method: 'POST',
    body: JSON.stringify({ version_id: versionId }),
    persistence: {
      resourceKey: `palace:${id}:restore-version:${versionId}`,
      description: 'Restore palace version',
      replayMode: 'manual',
    },
  })
}

export function getPalaceChaptersApi(id: number) {
  return request<Array<ChapterSummary & { subject?: { id: number; name: string } | null }>>(
    `/palaces/${id}/chapters`,
  )
}

export function linkPalaceChaptersApi(
  palaceId: number,
  data: { chapter_ids: number[]; primary_chapter_id?: number | null },
) {
  return request<{
    chapters: Array<ChapterSummary & { subject?: { id: number; name: string } | null }>
  }>(`/palaces/${palaceId}/chapters`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}
