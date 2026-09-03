import {
  removePendingTimeRecordRecovery,
  persistStudySessionRecord,
  type SessionCompletionMethod,
  type SessionEventRecord,
  type SessionKind,
  type TimeSessionRecord,
  upsertPendingTimeRecordRecovery,
} from '@/modules/session/domain/session-entity/model'
import {
  buildRecordFromExpiredSuspendedSnapshot,
} from '@/shared/hooks/timedSessionSnapshot'
import type {
  RestorableTimedSessionSnapshot,
  SessionSceneSegment,
  TimedSessionSourceKind,
} from '@/shared/hooks/timedSessionModel'
import { detectClientSource } from '@/shared/lib/clientSource'

const terminalCompletionMethods = new Set<SessionCompletionMethod>([
  'manual_complete',
  'auto_complete',
  'restart',
  'left_page',
  'all_units_passed',
])
const recordPersistenceChains = new Map<string, Promise<void>>()
const terminalRecordIds = new Set<string>()

export function buildTimedSessionRecord(input: {
  id: string
  sessionKey?: string | null
  clientRevision?: number
  operationId?: string | null
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
  /** Deprecated timer input; live timers never edit historical duration. */
  durationEdited?: boolean
  events: SessionEventRecord[]
  sceneSegments: SessionSceneSegment[]
}): TimeSessionRecord | null {
  if (!input.startedAt) return null
  return {
    id: input.id,
    sessionKey: input.sessionKey ?? null,
    clientRevision: Math.max(1, Math.round(input.clientRevision ?? 1)),
    operationId:
      input.operationId?.trim() || `timer:${input.id}:${input.completionMethod}`,
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
    // Duration edits belong exclusively to the history editor. A live timer
    // record is always an observed foreground duration.
    durationEdited: false,
    clientSource: detectClientSource(),
    events: [...input.events],
    sceneSegments: [...input.sceneSegments],
  }
}

export async function persistTimedSessionRecord(
  record: TimeSessionRecord | null,
) {
  if (!record) return null

  const isTerminal = terminalCompletionMethods.has(record.completionMethod)
  if (isTerminal) {
    terminalRecordIds.add(record.id)
  } else if (terminalRecordIds.has(record.id)) {
    return record
  }

  const previous = recordPersistenceChains.get(record.id) ?? Promise.resolve()
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      // An autosave that reaches the queue after completion is stale.
      if (!isTerminal && terminalRecordIds.has(record.id)) {
        return record
      }
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
    })
  const tracked = operation.then(() => undefined, () => undefined)
  recordPersistenceChains.set(record.id, tracked)
  void tracked.finally(() => {
    if (recordPersistenceChains.get(record.id) === tracked) {
      recordPersistenceChains.delete(record.id)
    }
  })
  return operation
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
