import type { SessionKind, SessionSceneSegment, TimeSessionRecord } from '@/entities/session/model'
import {
  createStableRecordId,
  normalizeSnapshot,
  nowIso,
  SNAPSHOT_STORAGE_PREFIX,
  SNAPSHOT_VERSION,
  type ActiveSceneSegmentSnapshot,
  type PersistedSessionStatus,
  type PersistedTimedSessionSnapshotV2,
  type RestorableTimedSessionSnapshot,
  type TimedSessionMeta,
  type TimedSessionSourceKind,
} from './timedSessionModel'

interface TimedSessionSnapshotSource {
  recordId: string | null
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: PersistedSessionStatus
  startedAt: string
  durationEdited: boolean
  events: RestorableTimedSessionSnapshot['events']
  sceneSegments: SessionSceneSegment[]
  activeSceneSegment: ActiveSceneSegmentSnapshot | null
}

interface SnapshotPersistenceOptions {
  suspended?: boolean
  suspendedAt?: string | null
  resumeDeadlineAt?: string | null
  leaveMeta?: TimedSessionMeta | null
}

export interface RestoredTimedSessionSnapshot {
  snapshot: RestorableTimedSessionSnapshot
  effectiveSeconds: number
}

export function buildPersistedTimedSessionSnapshot(
  source: TimedSessionSnapshotSource,
  options?: SnapshotPersistenceOptions,
): PersistedTimedSessionSnapshotV2 {
  return {
    version: SNAPSHOT_VERSION,
    recordId: source.recordId,
    kind: source.kind,
    palaceId: source.palaceId,
    sourceKind: source.sourceKind,
    englishCourseId: source.englishCourseId,
    title: source.title,
    effectiveSeconds: source.effectiveSeconds,
    pauseCount: source.pauseCount,
    status: source.status,
    startedAt: source.startedAt,
    durationEdited: source.durationEdited,
    events: [...source.events],
    persistedAt: nowIso(),
    suspended: options?.suspended ?? false,
    suspendedAt: options?.suspendedAt ?? null,
    resumeDeadlineAt: options?.resumeDeadlineAt ?? null,
    leaveMeta: options?.leaveMeta ?? null,
    sceneSegments: [...source.sceneSegments],
    activeSceneSegment: source.activeSceneSegment,
  }
}

export function writePersistedTimedSessionSnapshot(
  storageKey: string,
  snapshot: PersistedTimedSessionSnapshotV2,
) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot))
  } catch {
    // Ignore storage errors in private mode or restricted environments.
  }
}

export function buildRestorableTimedSessionSnapshot(
  source: TimedSessionSnapshotSource,
  options?: SnapshotPersistenceOptions,
): RestorableTimedSessionSnapshot {
  return {
    ...buildPersistedTimedSessionSnapshot(source, options),
    sceneSegments: [...source.sceneSegments],
    activeSceneSegment: source.activeSceneSegment,
  }
}

export function readRestorableTimedSessionSnapshot(
  storageKey: string,
): RestorableTimedSessionSnapshot | null {
  let parsed: RestorableTimedSessionSnapshot | null = null
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    parsed = normalizeSnapshot(raw ? JSON.parse(raw) : null)
    if (!parsed) {
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const candidateKey = window.sessionStorage.key(index)
        if (!candidateKey || !candidateKey.startsWith(SNAPSHOT_STORAGE_PREFIX) || candidateKey === storageKey) {
          continue
        }
        const candidateRaw = window.sessionStorage.getItem(candidateKey)
        const candidate = normalizeSnapshot(candidateRaw ? JSON.parse(candidateRaw) : null)
        if (!candidate?.suspended) {
          continue
        }
        const candidateAt = new Date(candidate.persistedAt).getTime()
        const parsedAt = parsed ? new Date(parsed.persistedAt).getTime() : Number.NEGATIVE_INFINITY
        if (!parsed || candidateAt > parsedAt) {
          parsed = candidate
        }
      }
    }
  } catch {
    parsed = null
  }
  return parsed
}

export function isExpiredSuspendedSnapshot(snapshot: RestorableTimedSessionSnapshot) {
  if (!snapshot.suspended) return false
  const deadlineMs = snapshot.resumeDeadlineAt ? new Date(snapshot.resumeDeadlineAt).getTime() : Number.NaN
  return !Number.isFinite(deadlineMs) || Date.now() > deadlineMs
}

export function resolveRestoredTimedSessionSnapshot(
  snapshot: RestorableTimedSessionSnapshot,
): RestoredTimedSessionSnapshot {
  const persistedAtMs = new Date(snapshot.persistedAt).getTime()
  const elapsedSincePersistSeconds =
    !snapshot.suspended && snapshot.status === 'running' && Number.isFinite(persistedAtMs)
      ? Math.max(0, Math.floor((Date.now() - persistedAtMs) / 1000))
      : 0
  return {
    snapshot,
    effectiveSeconds: Math.max(
      0,
      Math.round(snapshot.effectiveSeconds + elapsedSincePersistSeconds),
    ),
  }
}

export function buildRecordFromExpiredSuspendedSnapshot(
  snapshot: RestorableTimedSessionSnapshot,
): TimeSessionRecord | null {
  if (!snapshot.startedAt) return null
  if (snapshot.leaveMeta?.persisted_record === true) return null
  const endedAt = snapshot.suspendedAt ?? snapshot.persistedAt ?? nowIso()
  const sceneSegments = [...snapshot.sceneSegments]
  const activeSegment = snapshot.activeSceneSegment
  if (activeSegment) {
    const effectiveSegmentSeconds = Math.max(
      0,
      Math.round(snapshot.effectiveSeconds - activeSegment.startEffectiveSeconds),
    )
    if (effectiveSegmentSeconds > 0) {
      sceneSegments.push({
        scene: activeSegment.scene,
        kind: activeSegment.kind,
        palaceId: activeSegment.palaceId,
        sourceKind: activeSegment.sourceKind,
        englishCourseId: activeSegment.englishCourseId,
        title: activeSegment.title,
        startedAt: activeSegment.startedAt,
        endedAt,
        effectiveSeconds: effectiveSegmentSeconds,
      })
    }
  }
  return {
    id: snapshot.recordId ?? createStableRecordId(),
    kind: snapshot.kind,
    palaceId: snapshot.palaceId,
    sourceKind: snapshot.sourceKind,
    englishCourseId: snapshot.englishCourseId,
    title: snapshot.title,
    startedAt: snapshot.startedAt,
    endedAt,
    effectiveSeconds: snapshot.effectiveSeconds,
    pauseCount: snapshot.pauseCount,
    completionMethod: 'left_page',
    durationEdited: snapshot.durationEdited,
    events: [...snapshot.events],
    sceneSegments,
  }
}
