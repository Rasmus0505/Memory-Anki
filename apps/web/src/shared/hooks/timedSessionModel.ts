import type {
  SessionCompletionMethod,
  SessionEventRecord,
  SessionKind,
  SessionScene,
  SessionSceneSegment,
  TimeSessionRecord,
} from '@/entities/session/model'
import type {
  TimerAutomationActivityKind,
  TimerAutomationScene,
} from '@/shared/components/session/timer-automation-config'
import { formatLocalApiDateTime } from '@/shared/lib/dateTime'

export const AUTO_PAUSE_MS = 2 * 60 * 1000
export const HIDDEN_PAUSE_MS = 15 * 1000
export const SNAPSHOT_STORAGE_PREFIX = 'memory-anki-timed-session:'
export const SNAPSHOT_VERSION = 2

export type TimedSessionMeta = Record<string, boolean | number | string | null>
export type TimedSessionSourceKind = 'palace' | 'english' | 'english_reading' | null
export type SessionStatus = 'idle' | 'running' | 'paused' | 'completed'
export type GlowState = 'idle' | 'running' | 'paused'
export type PersistedSessionStatus = Extract<SessionStatus, 'running' | 'paused'>

export interface TimedSessionOptions {
  kind: SessionKind
  title: string
  palaceId: number | null
  automationScene?: TimerAutomationScene
  sourceKind?: TimedSessionSourceKind
  englishCourseId?: number | null
  autoPauseMs?: number
  hiddenPauseMs?: number
  persistKey?: string | null
  persistCompletionRecord?: boolean
}

export interface TimedSessionController {
  sessionId: string
  effectiveSeconds: number
  idleSeconds: number
  pauseCount: number
  status: SessionStatus
  startedAt: string | null
  durationEdited: boolean
  glowState: GlowState
  start: (meta?: TimedSessionMeta) => void
  pause: (meta?: TimedSessionMeta) => void
  resume: (meta?: TimedSessionMeta) => void
  setSceneActive: (active: boolean, meta?: TimedSessionMeta) => void
  leaveScene: (meta?: TimedSessionMeta) => Promise<TimeSessionRecord | null>
  registerActivity: (activityKind: TimerAutomationActivityKind, meta?: TimedSessionMeta) => void
  logEvent: (type: SessionEventRecord['type'], meta?: TimedSessionMeta) => void
  adjustDuration: (seconds: number) => void
  complete: (method: SessionCompletionMethod, meta?: TimedSessionMeta) => Promise<TimeSessionRecord | null>
  reset: () => void
}

export function buildTimedSessionController(controller: TimedSessionController) {
  return controller
}

export interface ActiveSceneSegmentSnapshot {
  scene: SessionScene
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  startedAt: string
  startEffectiveSeconds: number
}

export interface PersistedTimedSessionSnapshotV2 {
  version: 2
  recordId: string | null
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: PersistedSessionStatus
  startedAt: string | null
  durationEdited: boolean
  events: SessionEventRecord[]
  persistedAt: string
  suspended: boolean
  suspendedAt: string | null
  resumeDeadlineAt: string | null
  leaveMeta: TimedSessionMeta | null
  sceneSegments?: SessionSceneSegment[]
  activeSceneSegment?: ActiveSceneSegmentSnapshot | null
}

export interface LegacyPersistedTimedSessionSnapshot {
  version: 1
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: SessionStatus
  startedAt: string | null
  durationEdited: boolean
  events: SessionEventRecord[]
  persistedAt: string
}

export interface RestorableTimedSessionSnapshot {
  version: 2
  recordId: string | null
  kind: SessionKind
  palaceId: number | null
  sourceKind: TimedSessionSourceKind
  englishCourseId: number | null
  title: string
  effectiveSeconds: number
  pauseCount: number
  status: PersistedSessionStatus
  startedAt: string | null
  durationEdited: boolean
  events: SessionEventRecord[]
  persistedAt: string
  suspended: boolean
  suspendedAt: string | null
  resumeDeadlineAt: string | null
  leaveMeta: TimedSessionMeta | null
  sceneSegments: SessionSceneSegment[]
  activeSceneSegment: ActiveSceneSegmentSnapshot | null
}

export interface ResolvedTimedSessionAutomation {
  autoPauseMs: number
  hiddenPauseMs: number
  resumeWindowMs: number
  autoPauseRollbackSeconds: number
}

interface TimedSessionAutomationRuleInput {
  inactiveAutoPauseSeconds: number
  hiddenAutoPauseSeconds: number
  autoPauseRollbackSeconds: number
}

function nowIso() {
  return formatLocalApiDateTime(new Date())
}

export { nowIso }
export type { SessionSceneSegment }

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createStableRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return randomId()
}

export function normalizeSnapshot(
  value: unknown,
): RestorableTimedSessionSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.version === 1) {
    const status = raw.status
    if (status !== 'running' && status !== 'paused') {
      return null
    }
    return {
      version: 2,
      recordId: null,
      kind: raw.kind as SessionKind,
      palaceId: typeof raw.palaceId === 'number' ? raw.palaceId : null,
      sourceKind:
        raw.sourceKind === 'palace' ||
        raw.sourceKind === 'english' ||
        raw.sourceKind === 'english_reading'
          ? raw.sourceKind
          : null,
      englishCourseId: typeof raw.englishCourseId === 'number' ? raw.englishCourseId : null,
      title: typeof raw.title === 'string' ? raw.title : '',
      effectiveSeconds: Math.max(0, Math.round(Number(raw.effectiveSeconds) || 0)),
      pauseCount: Math.max(0, Math.round(Number(raw.pauseCount) || 0)),
      status,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
      durationEdited: Boolean(raw.durationEdited),
      events: Array.isArray(raw.events) ? (raw.events as SessionEventRecord[]) : [],
      persistedAt: typeof raw.persistedAt === 'string' ? raw.persistedAt : nowIso(),
      suspended: false,
      suspendedAt: null,
      resumeDeadlineAt: null,
      leaveMeta: null,
      sceneSegments: [],
      activeSceneSegment: null,
    }
  }

  if (raw.version !== SNAPSHOT_VERSION) {
    return null
  }

  const status = raw.status
  if (status !== 'running' && status !== 'paused') {
    return null
  }

  return {
    version: 2,
    recordId: typeof raw.recordId === 'string' && raw.recordId ? raw.recordId : null,
    kind: raw.kind as SessionKind,
    palaceId: typeof raw.palaceId === 'number' ? raw.palaceId : null,
    sourceKind:
      raw.sourceKind === 'palace' ||
      raw.sourceKind === 'english' ||
      raw.sourceKind === 'english_reading'
        ? raw.sourceKind
        : null,
    englishCourseId: typeof raw.englishCourseId === 'number' ? raw.englishCourseId : null,
    title: typeof raw.title === 'string' ? raw.title : '',
    effectiveSeconds: Math.max(0, Math.round(Number(raw.effectiveSeconds) || 0)),
    pauseCount: Math.max(0, Math.round(Number(raw.pauseCount) || 0)),
    status,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    durationEdited: Boolean(raw.durationEdited),
    events: Array.isArray(raw.events) ? (raw.events as SessionEventRecord[]) : [],
    persistedAt: typeof raw.persistedAt === 'string' ? raw.persistedAt : nowIso(),
    suspended: Boolean(raw.suspended),
    suspendedAt: typeof raw.suspendedAt === 'string' ? raw.suspendedAt : null,
    resumeDeadlineAt: typeof raw.resumeDeadlineAt === 'string' ? raw.resumeDeadlineAt : null,
    leaveMeta:
      raw.leaveMeta && typeof raw.leaveMeta === 'object'
        ? (raw.leaveMeta as TimedSessionMeta)
        : null,
    sceneSegments: Array.isArray(raw.sceneSegments) ? (raw.sceneSegments as SessionSceneSegment[]) : [],
    activeSceneSegment:
      raw.activeSceneSegment && typeof raw.activeSceneSegment === 'object'
        ? (raw.activeSceneSegment as ActiveSceneSegmentSnapshot)
        : null,
  }
}

export function resolveTimedSessionAutomation(
  rule: TimedSessionAutomationRuleInput,
  overrides: {
    autoPauseMs?: number
    hiddenPauseMs?: number
  },
): ResolvedTimedSessionAutomation {
  const resolvedInactiveMs = Math.max(
    0,
    Math.round(overrides.autoPauseMs ?? rule.inactiveAutoPauseSeconds * 1000),
  )
  return {
    autoPauseMs: resolvedInactiveMs,
    hiddenPauseMs: Math.max(
      0,
      Math.round(overrides.hiddenPauseMs ?? rule.hiddenAutoPauseSeconds * 1000),
    ),
    resumeWindowMs: resolvedInactiveMs,
    autoPauseRollbackSeconds: Math.max(
      0,
      Math.min(
        Math.round(rule.autoPauseRollbackSeconds),
        Math.round(rule.inactiveAutoPauseSeconds),
      ),
    ),
  }
}
