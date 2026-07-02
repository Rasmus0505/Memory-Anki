import type { PersistedRequestInit } from '@/shared/api/http'
import type {
  SessionCompletionMethod,
  SessionKind,
  TimeSessionRecord,
} from '@/entities/session/model/session-records'
import {
  createStudySessionFromTimeRecordApi,
  getStudySessionThresholdApi,
  listStudySessionsApi,
  patchStudySessionApi,
  type StudySessionPayload,
  restoreStudySessionApi,
  setStudySessionThresholdApi,
  softDeleteStudySessionApi,
  type StudySessionItem,
} from '@/entities/study-session/api'

export interface TimeRecordListResponse {
  items: TimeSessionRecord[]
}

export async function listTimeRecordsApi(options?: {
  includeDeleted?: boolean
  includeBelowThreshold?: boolean
}) {
  return listStudySessionRecordsApi(options)
}

export async function listStudySessionRecordsApi(options?: {
  includeDeleted?: boolean
  includeBelowThreshold?: boolean
}) {
  const result = await listStudySessionsApi(options)
  return { items: result.items.map(studySessionToTimeRecord) }
}

export async function createTimeRecordApi(
  record: Omit<TimeSessionRecord, 'id'> & { id?: string },
  options?: {
    mutationId?: string
    persistence?: PersistedRequestInit['persistence']
  },
) {
  return createStudySessionRecordApi(record, options)
}

export async function createStudySessionRecordApi(
  record: Omit<TimeSessionRecord, 'id'> & { id?: string },
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
  return { item: result.item ? studySessionToTimeRecord(result.item) : null }
}

export async function updateTimeRecordApi(
  id: string,
  updater: Partial<TimeSessionRecord>,
) {
  return updateStudySessionRecordApi(id, updater)
}

export async function updateStudySessionRecordApi(
  id: string,
  updater: Partial<TimeSessionRecord>,
) {
  const result = await patchStudySessionApi(id, timeRecordPatchToStudySessionPatch(updater), {
    persistence: {
      resourceKey: `study-session:${id}`,
      coalesceKey: `study-session:${id}`,
      description: '更新学习会话',
      replayMode: 'auto',
    },
  })
  return { item: result.item ? studySessionToTimeRecord(result.item) : null }
}

export async function softDeleteTimeRecordApi(id: string) {
  return softDeleteStudySessionRecordApi(id)
}

export async function softDeleteStudySessionRecordApi(id: string) {
  const result = await softDeleteStudySessionApi(id, {
    persistence: {
      resourceKey: `study-session:${id}:soft-delete`,
      description: '删除学习会话',
      replayMode: 'manual',
    },
  })
  return { item: result.item ? studySessionToTimeRecord(result.item) : null }
}

export async function restoreTimeRecordApi(id: string) {
  return restoreStudySessionRecordApi(id)
}

export async function restoreStudySessionRecordApi(id: string) {
  const result = await restoreStudySessionApi(id, {
    persistence: {
      resourceKey: `study-session:${id}:restore`,
      description: '恢复学习会话',
      replayMode: 'manual',
    },
  })
  return { item: result.item ? studySessionToTimeRecord(result.item) : null }
}

export async function getTimeRecordingThresholdApi() {
  return getStudySessionRecordingThresholdApi()
}

export async function getStudySessionRecordingThresholdApi() {
  return getStudySessionThresholdApi()
}

export async function setTimeRecordingThresholdApi(seconds: number) {
  return setStudySessionRecordingThresholdApi(seconds)
}

export async function setStudySessionRecordingThresholdApi(seconds: number) {
  return setStudySessionThresholdApi(seconds)
}

export async function importLegacyTimeRecordsApi(records: TimeSessionRecord[]) {
  const results = await Promise.all(records.map((record) => createStudySessionFromTimeRecordApi(record)))
  return { imported: results.filter((result) => result.item).length }
}

export function buildTimeRecord(
  params: Omit<TimeSessionRecord, 'id'> & { id?: string },
): Omit<TimeSessionRecord, 'id'> & { id?: string } {
  return params
}

export type { SessionCompletionMethod, SessionKind }

function studySessionToTimeRecord(item: StudySessionItem): TimeSessionRecord {
  const summary = item.summary || {}
  const sceneSegments = readSceneSegments(summary)
  return {
    id: item.id,
    kind: studySceneToSessionKind(item.scene),
    palaceId: item.palace_id,
    palaceSegmentId: item.palace_segment_id,
    sourceKind: studySceneToSourceKind(item.scene),
    englishCourseId: item.english_course_id,
    title: item.title,
    startedAt: item.started_at || '',
    endedAt: item.ended_at || item.updated_at || item.started_at || '',
    effectiveSeconds: item.effective_seconds,
    pauseCount: item.pause_count,
    completionMethod: (item.completion_method || 'manual_complete') as TimeSessionRecord['completionMethod'],
    durationEdited: Boolean(summary.duration_edited),
    deletedAt: item.deleted_at,
    deletedReason: item.deleted_reason === 'manual' ? 'manual' : null,
    events: item.events as TimeSessionRecord['events'],
    sceneSegments,
  }
}

function readSceneSegments(summary: Record<string, unknown>): TimeSessionRecord['sceneSegments'] {
  const value = summary.scene_segments
  return Array.isArray(value) ? value as TimeSessionRecord['sceneSegments'] : []
}

function studySceneToSessionKind(scene: string): SessionKind {
  if (scene === 'palace_edit') return 'palace_edit'
  if (scene === 'quiz') return 'quiz'
  if (scene === 'review' || scene === 'segment_review' || scene === 'mini_review') return 'review'
  return 'practice'
}

function studySceneToSourceKind(scene: string): TimeSessionRecord['sourceKind'] {
  if (scene === 'english') return 'english'
  if (scene === 'english_reading') return 'english_reading'
  return scene ? 'palace' : null
}

function timeRecordPatchToStudySessionPatch(
  updater: Partial<TimeSessionRecord>,
): Partial<StudySessionPayload> {
  const patch: Partial<StudySessionPayload> = {}
  if ('kind' in updater && updater.kind) patch.scene = sessionKindToStudyScene(updater.kind, updater.sourceKind)
  if ('sourceKind' in updater) patch.scene = sessionKindToStudyScene(updater.kind || 'practice', updater.sourceKind)
  if ('palaceId' in updater) {
    patch.palace_id = updater.palaceId ?? null
    if (updater.palaceId != null) {
      patch.target_type = 'palace'
      patch.target_id = updater.palaceId
    }
  }
  if ('palaceSegmentId' in updater) {
    patch.palace_segment_id = updater.palaceSegmentId ?? null
    if (updater.palaceSegmentId != null) {
      patch.target_type = 'palace_segment'
      patch.target_id = updater.palaceSegmentId
    }
  }
  if ('englishCourseId' in updater) {
    patch.english_course_id = updater.englishCourseId ?? null
    if (updater.englishCourseId != null) {
      patch.target_type = 'english_course'
      patch.target_id = updater.englishCourseId
    }
  }
  if ('title' in updater) patch.title = updater.title ?? ''
  if ('startedAt' in updater) patch.started_at = updater.startedAt ?? null
  if ('endedAt' in updater) patch.ended_at = updater.endedAt ?? null
  if ('effectiveSeconds' in updater) patch.effective_seconds = updater.effectiveSeconds ?? 0
  if ('pauseCount' in updater) patch.pause_count = updater.pauseCount ?? 0
  if ('completionMethod' in updater) patch.completion_method = updater.completionMethod ?? 'manual_complete'
  if ('events' in updater) patch.events = updater.events ?? []
  if ('sceneSegments' in updater || 'durationEdited' in updater) {
    patch.summary = {
      ...(updater.sceneSegments ? { scene_segments: updater.sceneSegments } : {}),
      ...(typeof updater.durationEdited === 'boolean' ? { duration_edited: updater.durationEdited } : {}),
    }
  }
  return patch
}

function sessionKindToStudyScene(
  kind: TimeSessionRecord['kind'],
  sourceKind?: TimeSessionRecord['sourceKind'],
) {
  if (sourceKind === 'english') return 'english'
  if (sourceKind === 'english_reading') return 'english_reading'
  if (kind === 'palace_edit') return 'palace_edit'
  if (kind === 'quiz') return 'quiz'
  if (kind === 'review') return 'review'
  return 'practice'
}
