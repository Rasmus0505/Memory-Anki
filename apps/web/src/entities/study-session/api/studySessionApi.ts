import { request } from '@/shared/api/http'
import type { PersistedRequestInit } from '@/shared/api/http'

export type StudySessionStatus = 'active' | 'paused' | 'completed' | 'abandoned' | 'recovered'

export type StudySessionScene =
  | 'palace_edit'
  | 'practice'
  | 'focus_practice'
  | 'segment_practice'
  | 'mini_practice'
  | 'review'
  | 'quiz'
  | 'freestyle'
  | 'english'
  | 'english_reading'

export type StudySessionTargetType =
  | 'palace'
  | 'palace_segment'
  | 'mini_palace'
  | 'review_schedule'
  | 'english_course'
  | 'english_reading_material'
  | 'freestyle'
  | 'none'

export interface StudySessionEvent {
  type: string
  at: string
  meta?: Record<string, boolean | number | string | null | undefined>
}

export interface StudySessionItem {
  id: string
  status: StudySessionStatus
  scene: StudySessionScene | string
  target_type: StudySessionTargetType | string
  target_id: number | null
  palace_id: number | null
  palace_segment_id: number | null
  mini_palace_id: number | null
  english_course_id: number | null
  english_reading_material_id: number | null
  title: string
  started_at: string | null
  ended_at: string | null
  effective_seconds: number
  idle_seconds: number
  pause_count: number
  completion_method: string
  progress: Record<string, unknown>
  events: StudySessionEvent[]
  summary: Record<string, unknown>
  deleted_at: string | null
  deleted_reason: string | null
  created_at: string | null
  updated_at: string | null
}

export interface StudySessionPayload {
  id?: string
  status?: StudySessionStatus
  scene: StudySessionScene | string
  target_type?: StudySessionTargetType | string
  target_id?: number | null
  palace_id?: number | null
  palace_segment_id?: number | null
  mini_palace_id?: number | null
  english_course_id?: number | null
  english_reading_material_id?: number | null
  title?: string
  started_at?: string | null
  ended_at?: string | null
  effective_seconds?: number
  idle_seconds?: number
  pause_count?: number
  completion_method?: string
  progress?: unknown
  events?: StudySessionEvent[]
  summary?: Record<string, unknown>
}

export interface StudySessionRecordPayload {
  id?: string
  kind: string
  palaceId?: number | null
  palaceSegmentId?: number | null
  sourceKind?: string | null
  englishCourseId?: number | null
  title?: string
  startedAt?: string
  endedAt?: string
  effectiveSeconds?: number
  pauseCount?: number
  completionMethod?: string
  durationEdited?: boolean
  events?: unknown[]
  sceneSegments?: unknown[]
  deletedAt?: string | null
  deletedReason?: string | null
}

export interface StudySessionListOptions {
}

function listPath(_options?: StudySessionListOptions) {
  return '/study-sessions'
}

export function createStudySessionApi(payload: StudySessionPayload) {
  return request<{ item: StudySessionItem }>('/study-sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `study-session:${payload.id ?? payload.scene}:create`,
      description: 'Create study session',
      replayMode: 'auto',
    },
  })
}

export function getStudySessionApi(id: string) {
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}`)
}

export function listStudySessionsApi(options?: StudySessionListOptions) {
  return request<{ items: StudySessionItem[] }>(listPath(options))
}

export function patchStudySessionApi(
  id: string,
  payload: Partial<StudySessionPayload>,
  options?: { persistence?: PersistedRequestInit['persistence'] },
) {
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    persistence: options?.persistence ?? {
        resourceKey: `study-session:${id}`,
        coalesceKey: `study-session:${id}`,
        description: 'Update study session',
        replayMode: 'auto',
      },
  })
}

export function appendStudySessionEventsApi(id: string, events: StudySessionEvent[]) {
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}/events`, {
    method: 'POST',
    body: JSON.stringify({ events }),
    persistence: {
      resourceKey: `study-session:${id}:events`,
      description: 'Append study session events',
      replayMode: 'auto',
    },
  })
}

export function completeStudySessionApi(id: string, payload: Partial<StudySessionPayload>) {
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `study-session:${id}:complete`,
      description: 'Complete study session',
      replayMode: 'auto',
    },
  })
}

export function abandonStudySessionApi(id: string, payload: Partial<StudySessionPayload>) {
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}/abandon`, {
    method: 'POST',
    body: JSON.stringify(payload),
    persistence: {
      resourceKey: `study-session:${id}:abandon`,
      description: 'Abandon study session',
      replayMode: 'manual',
    },
  })
}

export function getActiveStudySessionByTargetApi(params: {
  targetType: StudySessionTargetType | string
  targetId?: number | null
  scene?: StudySessionScene | string | null
}) {
  const query = new URLSearchParams()
  query.set('target_type', params.targetType)
  if (params.targetId != null) query.set('target_id', String(params.targetId))
  if (params.scene) query.set('scene', params.scene)
  return request<{ item: StudySessionItem | null }>(`/study-sessions/by-target?${query}`)
}

export function createStudySessionFromTimeRecordApi(
  payload: object & { id?: unknown },
  options?: {
    mutationId?: string
    persistence?: PersistedRequestInit['persistence']
  },
) {
  return request<{ item: StudySessionItem | null }>('/study-sessions/from-time-record', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: options?.mutationId
      ? {
          'X-Memory-Anki-Mutation-ID': options.mutationId,
        }
      : undefined,
    persistence: options?.persistence ?? {
        resourceKey: `study-session:time-record:${String(payload.id ?? '')}`,
        description: 'Create study session from time record',
        replayMode: 'auto',
      },
  })
}

export async function createStudySessionRecordApi(
  record: StudySessionRecordPayload,
  options?: {
    mutationId?: string
    persistence?: PersistedRequestInit['persistence']
  },
) {
  const id = record.id ?? crypto.randomUUID()
  const persistence =
    options?.persistence === undefined
      ? {
          resourceKey: `study-session:${id}`,
          description: `保存学习会话：${record.title || record.kind}`,
          replayMode: 'auto' as const,
        }
      : options.persistence
  const result = await createStudySessionFromTimeRecordApi(
    { ...record, id },
    {
      mutationId: options?.mutationId,
      persistence,
    },
  )
  return { item: result.item }
}

export function deleteStudySessionApi(
  id: string,
  options?: { persistence?: PersistedRequestInit['persistence'] },
) {
  return request<{ ok: boolean }>(`/study-sessions/${id}`, {
    method: 'DELETE',
    persistence: options?.persistence,
  })
}

export function bulkDeleteStudySessionsApi(
  ids: string[],
  options?: { persistence?: PersistedRequestInit['persistence'] },
) {
  return request<{ ok: boolean; deleted: number }>('/study-sessions/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
    persistence: options?.persistence,
  })
}
