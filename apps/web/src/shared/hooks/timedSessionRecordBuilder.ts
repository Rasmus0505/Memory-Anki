import {
  removePendingTimeRecordRecovery,
  persistStudySessionRecord,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type SessionKind,
  type TimeSessionRecord,
  upsertPendingTimeRecordRecovery,
} from '@/entities/session/model'
import {
  buildRecordFromExpiredSuspendedSnapshot,
} from './timedSessionSnapshot'
import type {
  RestorableTimedSessionSnapshot,
  SessionSceneSegment,
  TimedSessionSourceKind,
} from './timedSessionModel'

export function buildTimedSessionRecord(input: {
  id: string
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  startedAt: string | null
  endedAt: string
  effectiveSeconds: number
  pauseCount: number
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
  events: SessionEventRecord[]
  sceneSegments: SessionSceneSegment[]
}): TimeSessionRecord | null {
  if (!input.startedAt) return null
  return {
    id: input.id,
    kind: input.kind,
    palaceId: input.palaceId,
    sourceKind: input.sourceKind,
    englishCourseId: input.englishCourseId,
    title: input.title,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    effectiveSeconds: input.effectiveSeconds,
    pauseCount: input.pauseCount,
    completionMethod: input.completionMethod,
    durationEdited: input.durationEdited,
    events: [...input.events],
    sceneSegments: [...input.sceneSegments],
  }
}

export async function persistTimedSessionRecord(
  record: TimeSessionRecord | null,
) {
  if (!record) return null
  try {
    const persisted = await persistStudySessionRecord(record)
    removePendingTimeRecordRecovery(record.id)
    return persisted
  } catch {
    upsertPendingTimeRecordRecovery(record, {
      status: 'failed',
      lastError: '保存时间记录失败，已等待下次恢复',
    })
    return record
  }
}

export async function saveInProgressTimedSessionRecord(input: {
  startedAt: string | null
  completed: boolean
  buildRecord: () => TimeSessionRecord | null
  persistRecord: (record: TimeSessionRecord | null) => Promise<TimeSessionRecord | null>
}) {
  if (!input.startedAt || input.completed) {
    return
  }
  const record = input.buildRecord()
  if (!record) {
    return
  }
  await input.persistRecord(record)
}

export function buildRecordFromExpiredSuspendedTimedSessionSnapshot(
  snapshot: RestorableTimedSessionSnapshot,
) {
  return buildRecordFromExpiredSuspendedSnapshot(snapshot)
}
