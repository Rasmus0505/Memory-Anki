import type {
  FreestyleLearningInterval,
  FreestyleLearningTimeAdd,
} from '@/shared/api/contracts'
import {
  addFreestyleLearningSeconds,
  emptyFreestyleLearningTime,
  freestyleLearningAdds,
  mergeFreestyleLearningTime,
  parseFreestyleLearningTime,
  type FreestyleRoundLearningTime,
} from '../domain/freestyleLearningTime'

export const FREESTYLE_LEARNING_OUTBOX_VERSION = 2
export const MAX_LEARNING_INTERVALS_PER_BATCH = 500
export const MAX_LEARNING_INTERVAL_SECONDS = 12 * 60 * 60

export interface FreestyleLearningInflightBatch {
  operationId: string
  intervals: FreestyleLearningInterval[]
  adds: FreestyleLearningTimeAdd[]
}

export interface FreestyleLearningOutboxState {
  version: 2
  expectedVersion: number
  baseline: FreestyleRoundLearningTime
  pendingIntervals: FreestyleLearningInterval[]
  legacyAdds: FreestyleLearningTimeAdd[]
  migratedV1: boolean
  inflight: FreestyleLearningInflightBatch | null
  backfillOperationId: string
}

export function emptyFreestyleLearningOutbox(backfillOperationId: string): FreestyleLearningOutboxState {
  return {
    version: FREESTYLE_LEARNING_OUTBOX_VERSION,
    expectedVersion: 0,
    baseline: emptyFreestyleLearningTime(),
    pendingIntervals: [],
    legacyAdds: [],
    migratedV1: false,
    inflight: null,
    backfillOperationId,
  }
}

function validInterval(value: unknown): value is FreestyleLearningInterval {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<FreestyleLearningInterval>
  if (!item.interval_id || !item.session_id || !item.started_at || !item.ended_at) return false
  if (item.bucket !== 'unit' && item.bucket !== 'quiz' && item.bucket !== 'lookup') return false
  if (item.client_source !== 'desktop' && item.client_source !== 'pwa' && item.client_source !== 'unknown') return false
  const start = Date.parse(item.started_at)
  const end = Date.parse(item.ended_at)
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    && end - start <= MAX_LEARNING_INTERVAL_SECONDS * 1000
}

function normalizeAdd(value: unknown): FreestyleLearningTimeAdd | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<FreestyleLearningTimeAdd>
  if (item.bucket !== 'unit' && item.bucket !== 'quiz' && item.bucket !== 'lookup') return null
  const seconds = Math.round(Number(item.seconds))
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return {
    bucket: item.bucket,
    seconds,
    ...(Number.isInteger(item.palace_id) && Number(item.palace_id) > 0
      ? { palace_id: Number(item.palace_id) }
      : {}),
  }
}

function normalizeBatch(value: unknown): FreestyleLearningInflightBatch | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<FreestyleLearningInflightBatch>
  const intervals = Array.isArray(item.intervals) ? item.intervals.filter(validInterval).slice(0, MAX_LEARNING_INTERVALS_PER_BATCH) : []
  const adds = Array.isArray(item.adds) ? item.adds.map(normalizeAdd).filter((add): add is FreestyleLearningTimeAdd => Boolean(add)) : []
  if (!item.operationId || (!intervals.length && !adds.length)) return null
  return { operationId: String(item.operationId), intervals, adds }
}

export function parseFreestyleLearningOutbox(raw: unknown, fallbackBackfillOperationId: string): FreestyleLearningOutboxState {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const parsed = emptyFreestyleLearningOutbox(fallbackBackfillOperationId)
  parsed.expectedVersion = Math.max(0, Math.round(Number(source.expectedVersion ?? source.expected_version) || 0))
  parsed.baseline = parseFreestyleLearningTime(source.baseline)
  parsed.pendingIntervals = Array.isArray(source.pendingIntervals)
    ? source.pendingIntervals.filter(validInterval)
    : []
  parsed.legacyAdds = Array.isArray(source.legacyAdds)
    ? source.legacyAdds.map(normalizeAdd).filter((add): add is FreestyleLearningTimeAdd => Boolean(add))
    : []
  parsed.migratedV1 = source.migratedV1 === true
  parsed.inflight = normalizeBatch(source.inflight)
  if (typeof source.backfillOperationId === 'string' && source.backfillOperationId) {
    parsed.backfillOperationId = source.backfillOperationId
  }
  return parsed
}

export function serializeFreestyleLearningOutbox(state: FreestyleLearningOutboxState) {
  return JSON.stringify(state)
}

export function migrateLegacyFreestylePending(raw: unknown): FreestyleLearningTimeAdd[] {
  if (!raw || typeof raw !== 'object') return []
  return freestyleLearningAdds(parseFreestyleLearningTime(raw))
}

export function enqueueFreestyleLearningInterval(
  state: FreestyleLearningOutboxState,
  interval: FreestyleLearningInterval,
): FreestyleLearningOutboxState {
  if (!validInterval(interval) || state.pendingIntervals.some((item) => item.interval_id === interval.interval_id)
    || state.inflight?.intervals.some((item) => item.interval_id === interval.interval_id)) return state
  return { ...state, pendingIntervals: [...state.pendingIntervals, interval] }
}

export function beginFreestyleLearningBatch(
  state: FreestyleLearningOutboxState,
  operationId: string,
): FreestyleLearningOutboxState {
  if (state.inflight || (!state.pendingIntervals.length && !state.legacyAdds.length)) return state
  const intervals = state.pendingIntervals.slice(0, MAX_LEARNING_INTERVALS_PER_BATCH)
  const ids = new Set(intervals.map((item) => item.interval_id))
  return {
    ...state,
    pendingIntervals: state.pendingIntervals.filter((item) => !ids.has(item.interval_id)),
    legacyAdds: [],
    inflight: {
      operationId,
      intervals,
      adds: state.legacyAdds.slice(),
    },
  }
}

export function acknowledgeFreestyleLearningBatch(
  state: FreestyleLearningOutboxState,
  operationId: string,
): FreestyleLearningOutboxState {
  if (!state.inflight || state.inflight.operationId !== operationId) return state
  const ids = new Set(state.inflight.intervals.map((item) => item.interval_id))
  const adds = state.inflight.adds
  return {
    ...state,
    pendingIntervals: state.pendingIntervals.filter((item) => !ids.has(item.interval_id)),
    legacyAdds: state.legacyAdds.filter((item) => !adds.includes(item)),
    inflight: null,
  }
}

export function outboxLearningTime(state: FreestyleLearningOutboxState): FreestyleRoundLearningTime {
  let pending = emptyFreestyleLearningTime()
  const allIntervals = [...state.pendingIntervals, ...(state.inflight?.intervals ?? [])]
  for (const item of allIntervals) {
    const seconds = Math.max(1, Math.round((Date.parse(item.ended_at) - Date.parse(item.started_at)) / 1000))
    pending = addFreestyleLearningSeconds(pending, item.bucket, seconds, item.palace_id ?? null)
  }
  for (const add of state.legacyAdds) {
    pending = addFreestyleLearningSeconds(pending, add.bucket, add.seconds, add.palace_id ?? null)
  }
  return mergeFreestyleLearningTime(state.baseline, pending)
}

export function batchPayload(state: FreestyleLearningOutboxState) {
  return state.inflight
    ? { operation_id: state.inflight.operationId, intervals: state.inflight.intervals, adds: state.inflight.adds }
    : null
}
