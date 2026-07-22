import { request } from '@/shared/api/http'
import {
  clearSessionProgressApi,
  getSessionProgressApi,
  saveSessionProgressApi,
  type SessionProgressPayload,
} from '@/modules/session/public'
import type {
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


export interface PalaceKnowledgeBinding {
  palace_id: number
  subjects: Array<{ id: number; name: string; color: string; sort_order?: number }>
  explicit_chapter_ids: number[]
  inherited_chapter_ids: number[]
  primary_chapter_id: number | null
  binding_revision: number
  chapter_count?: number
}

export function updatePalaceKnowledgeBindingApi(
  palaceId: number,
  data: {
    subject_ids: number[]
    chapter_ids: number[]
    primary_chapter_id: number | null
    base_revision: number
    operation_id: string
  },
) {
  return request<PalaceKnowledgeBinding>(`/palaces/${palaceId}/knowledge-binding`, {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: `palace:${palaceId}:knowledge-binding`,
      coalesceKey: `palace:${palaceId}:knowledge-binding`,
      description: '保存宫殿学科与章节关联',
      replayMode: 'auto',
    },
  })
}
