import { request } from '@/shared/api/http'
import type { PersistedRequestInit } from '@/shared/api/http'

export type StudySessionStatus = 'active' | 'paused' | 'completed' | 'abandoned' | 'recovered'

export type StudySessionScene =
  | 'palace_edit'
  | 'practice'
  | 'review'
  | 'quiz'
  | 'freestyle'
  | 'english'
  | 'english_reading'

export type StudySessionTargetType =
  | 'palace'
  | 'palace_segment'
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
  /** Stable target identity used to merge page scenes into one session. */
  session_key?: string | null
  /** Monotonic client-side write revision. Older/equal writes are ignored. */
  client_revision?: number
  /** Storage spelling retained for audit/debug projections. */
  last_operation_id?: string | null
  /** Request spelling mirrored by the API response. */
  operation_id?: string | null
  scene: StudySessionScene | string
  target_type: StudySessionTargetType | string
  target_id: number | null
  palace_id: number | null
  palace_segment_id: number | null
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
  /** Stable target identity used to merge page scenes into one session. */
  session_key?: string | null
  /** Monotonic client-side write revision. */
  client_revision?: number | null
  /** Idempotency identity for this logical write. */
  operation_id?: string | null
  status?: StudySessionStatus
  scene: StudySessionScene | string
  target_type?: StudySessionTargetType | string
  target_id?: number | null
  palace_id?: number | null
  palace_segment_id?: number | null
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
  /** Camel-case record facade fields are normalized to the API names below. */
  sessionKey?: string | null
  clientRevision?: number | null
  operationId?: string | null
  /** Accepted for callers that already use the wire contract. */
  session_key?: string | null
  client_revision?: number | null
  operation_id?: string | null
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
  clientSource?: 'desktop' | 'pwa' | 'mobile' | null
  activityTag?: string | null
  activityTagLabel?: string | null
  events?: unknown[]
  sceneSegments?: unknown[]
  deletedAt?: string | null
  deletedReason?: string | null
}

export interface StudySessionListOptions {
  limit?: number
  offset?: number
  keyword?: string
  kind?: 'palace_edit' | 'practice' | 'quiz' | 'review' | 'custom'
  status?: 'active' | 'paused' | 'completed' | 'abandoned' | 'recovered'
  sortBy?: 'started_at' | 'effective_seconds' | 'title'
  sortOrder?: 'asc' | 'desc'
  /** Inclusive lower bound (ISO / API datetime). */
  startedFrom?: string | null
  /** Exclusive upper bound (ISO / API datetime). */
  startedTo?: string | null
  includeSourceSummary?: boolean
}

export interface StudySessionSourceSummary {
  total_effective_seconds: number
  desktop_effective_seconds: number
  pwa_effective_seconds: number
  unknown_effective_seconds: number
}

export interface StudySessionListResult {
  items: StudySessionItem[]
  total?: number
  limit?: number
  offset?: number
  source_summary?: StudySessionSourceSummary
}

export interface StudySessionAnalyticsResult {
  trend: Array<{ date_key: string; label: string; seconds: number }>
  breakdown: Array<{
    kind: string
    label: string
    seconds: number
    sessions: number
    is_builtin?: boolean
  }>
}

export type TimeRecordRangeMode = 'today' | 'month' | 'rolling' | 'custom' | 'all'
export type TimeRecordKind =
  | 'review'
  | 'practice'
  | 'quiz'
  | 'palace_edit'
  | 'english'
  | 'english_reading'
  | 'custom'

export interface TimeRecordReadOptions {
  rangeMode: TimeRecordRangeMode
  month?: string
  rollingDays?: 7 | 30 | 90
  startDate?: string
  endDate?: string
  keyword?: string
  kind?: TimeRecordKind
  sortBy?: 'started_at' | 'effective_seconds' | 'title'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface TimeRecordReadResult {
  items: StudySessionItem[]
  total: number
  limit: number
  offset: number
  range: {
    mode: TimeRecordRangeMode
    month: string | null
    rolling_days: number | null
    start_date: string | null
    end_date: string | null
  }
  summary: {
    record_count: number
    total_effective_seconds: number
    desktop_effective_seconds: number
    pwa_effective_seconds: number
    unknown_effective_seconds: number
  }
  kind_breakdown: Array<{
    kind: string
    label: string
    seconds: number
    sessions: number
    is_builtin: boolean
  }>
  trend: Array<{
    date_key: string
    label: string
    seconds: number
    records: number
  }>
}

function listPath(options?: StudySessionListOptions) {
  const query = new URLSearchParams()
  if (options?.limit != null) query.set('limit', String(options.limit))
  if (options?.offset != null) query.set('offset', String(options.offset))
  if (options?.keyword?.trim()) query.set('keyword', options.keyword.trim())
  if (options?.kind) query.set('kind', options.kind)
  if (options?.status) query.set('status', options.status)
  if (options?.sortBy) query.set('sort_by', options.sortBy)
  if (options?.sortOrder) query.set('sort_order', options.sortOrder)
  if (options?.startedFrom) query.set('started_from', options.startedFrom)
  if (options?.startedTo) query.set('started_to', options.startedTo)
  if (options?.includeSourceSummary) query.set('include_source_summary', 'true')
  const suffix = query.toString()
  return suffix ? `/study-sessions?${suffix}` : '/study-sessions'
}

function createOperationId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

function readPayloadField<T>(
  payload: Record<string, unknown>,
  snakeName: string,
  camelName: string,
) {
  if (Object.prototype.hasOwnProperty.call(payload, snakeName)) {
    return payload[snakeName] as T
  }
  if (Object.prototype.hasOwnProperty.call(payload, camelName)) {
    return payload[camelName] as T
  }
  return undefined
}

/**
 * Normalize version metadata at the session API boundary.
 *
 * Timer records are still represented in camelCase internally for compatibility,
 * while the HTTP contract is snake_case. Keeping this conversion here means
 * beacon/queue callers and ordinary fetch callers can share the same payload
 * semantics without each page reimplementing it.
 */
export function normalizeStudySessionWritePayload<T extends object>(
  payload: T & { id?: unknown },
  options?: { operationId?: string | null; defaultOperationId?: string },
) {
  const source = payload as Record<string, unknown>
  const {
    sessionKey: _sessionKey,
    clientRevision: _clientRevision,
    operationId: _operationId,
    ...wirePayload
  } = source
  const sessionKey = readPayloadField<string | null>(source, 'session_key', 'sessionKey')
  const clientRevision = readPayloadField<number | null>(source, 'client_revision', 'clientRevision')
  const operationId =
    readPayloadField<string | null>(source, 'operation_id', 'operationId') ??
    options?.operationId ??
    options?.defaultOperationId

  return {
    ...wirePayload,
    ...(sessionKey !== undefined ? { session_key: sessionKey } : {}),
    ...(clientRevision !== undefined ? { client_revision: clientRevision } : {}),
    ...(operationId ? { operation_id: operationId } : {}),
  }
}

function firstNonBlank(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0) ?? null
}

function deriveRecordSessionKey(source: Record<string, unknown>, id: string) {
  const explicit = firstNonBlank(
    readPayloadField<string | null>(source, 'session_key', 'sessionKey'),
  )
  if (explicit) return explicit
  const sourceKind = readPayloadField<string | null>(source, 'source_kind', 'sourceKind')
  const palaceId = readPayloadField<number | null>(source, 'palace_id', 'palaceId')
  const englishCourseId = readPayloadField<number | null>(source, 'english_course_id', 'englishCourseId')
  if (sourceKind === 'english' && englishCourseId != null) return `english:${englishCourseId}`
  if (sourceKind === 'english_reading') {
    const materialId = readPayloadField<number | null>(
      source,
      'english_reading_material_id',
      'englishReadingMaterialId',
    )
    if (materialId != null) return `english-reading:${materialId}`
  }
  if (palaceId != null) return `palace:${palaceId}`
  return `record:${id}`
}

/** Convert a local camelCase timer record to the canonical wire payload. */
export function serializeStudySessionRecordPayload<T extends object>(
  record: T & { id?: unknown },
) {
  const source = record as Record<string, unknown>
  const id = String(source.id ?? createOperationId('record'))
  const rawRevision = readPayloadField<number | null>(source, 'client_revision', 'clientRevision')
  const revision = rawRevision == null || !Number.isFinite(Number(rawRevision))
    ? 1
    : Math.max(1, Math.round(Number(rawRevision)))
  const explicitOperation = firstNonBlank(
    readPayloadField<string | null>(source, 'operation_id', 'operationId'),
  )
  const operationId = explicitOperation ?? `timer:${id}:r${revision}`
  const normalized = normalizeStudySessionWritePayload({ ...source, id }, {
    operationId,
  })
  const sessionKey = deriveRecordSessionKey(source, id)
  const durationEdited = Boolean(
    readPayloadField<boolean | null>(source, 'duration_edited', 'durationEdited'),
  )
  const {
    durationEdited: _durationEdited,
    ...withoutCamelDurationEdit
  } = normalized as Record<string, unknown>
  return {
    ...withoutCamelDurationEdit,
    id,
    session_key: sessionKey,
    client_revision: revision,
    operation_id: operationId,
    ...(durationEdited ? { duration_edited: true } : {}),
  }
}

function normalizeStudySessionPayload(
  payload: Partial<StudySessionPayload>,
  operationPrefix: string,
) {
  const normalized = normalizeStudySessionWritePayload(payload, {
    defaultOperationId: payload.operation_id ?? createOperationId(operationPrefix),
  })
  return normalized as StudySessionPayload
}

export function createStudySessionApi(payload: StudySessionPayload) {
  return request<{ item: StudySessionItem }>('/study-sessions', {
    method: 'POST',
    body: JSON.stringify(normalizeStudySessionPayload(payload, 'study-session:create')),
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
  return request<StudySessionListResult>(listPath(options))
}

export function getStudySessionAnalyticsApi(options: {
  trendRange: 7 | 30 | 90 | 'all'
  breakdownRange: 7 | 30 | 90 | 'all'
}) {
  const query = new URLSearchParams({
    trend_range: String(options.trendRange),
    breakdown_range: String(options.breakdownRange),
  })
  return request<StudySessionAnalyticsResult>(
    `/study-sessions/time-record-analytics?${query}`,
  )
}

export function getTimeRecordReadModelApi(options: TimeRecordReadOptions) {
  const query = new URLSearchParams({ range_mode: options.rangeMode })
  if (options.month) query.set('month', options.month)
  if (options.rollingDays) query.set('rolling_days', String(options.rollingDays))
  if (options.startDate) query.set('start_date', options.startDate)
  if (options.endDate) query.set('end_date', options.endDate)
  if (options.keyword?.trim()) query.set('keyword', options.keyword.trim())
  if (options.kind) query.set('kind', options.kind)
  if (options.sortBy) query.set('sort_by', options.sortBy)
  if (options.sortOrder) query.set('sort_order', options.sortOrder)
  if (options.limit != null) query.set('limit', String(options.limit))
  if (options.offset != null) query.set('offset', String(options.offset))
  return request<TimeRecordReadResult>(`/study-sessions/time-records?${query}`)
}

export function patchStudySessionApi(
  id: string,
  payload: Partial<StudySessionPayload>,
  options?: { persistence?: PersistedRequestInit['persistence'] },
) {
  const normalizedPayload = normalizeStudySessionPayload(payload, `study-session:${id}:patch`)
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(normalizedPayload),
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
  const normalizedPayload = normalizeStudySessionPayload(payload, `study-session:${id}:complete`)
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(normalizedPayload),
    persistence: {
      resourceKey: `study-session:${id}:complete`,
      description: 'Complete study session',
      replayMode: 'auto',
    },
  })
}

export function abandonStudySessionApi(id: string, payload: Partial<StudySessionPayload>) {
  const normalizedPayload = normalizeStudySessionPayload(payload, `study-session:${id}:abandon`)
  return request<{ item: StudySessionItem }>(`/study-sessions/${id}/abandon`, {
    method: 'POST',
    body: JSON.stringify(normalizedPayload),
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

export function createStudySessionFromTimeRecordApi<T extends object>(
  payload: T & { id?: unknown },
  options?: {
    mutationId?: string
    persistence?: PersistedRequestInit['persistence']
  },
) {
  const payloadSource = payload as Record<string, unknown>
  const resourceKey = `study-session:time-record:${String(payloadSource.id ?? '')}`
  const operationId = firstNonBlank(
    readPayloadField<string | null>(payloadSource, 'operation_id', 'operationId'),
    options?.mutationId,
    `timer:${String(payloadSource.id ?? 'new')}:${String(
      readPayloadField<string | null>(payloadSource, 'completion_method', 'completionMethod') ??
      'completed',
    )}`,
  )
  const source = payloadSource
  const normalizedPayload = {
    ...normalizeStudySessionWritePayload(payload, { operationId }),
    ...(readPayloadField<number | null>(source, 'client_revision', 'clientRevision') === undefined
      ? { client_revision: 1 }
      : {}),
  }
  return request<{ item: StudySessionItem | null }>('/study-sessions/from-time-record', {
    method: 'POST',
    body: JSON.stringify(normalizedPayload),
    headers: options?.mutationId
      ? {
          'X-Memory-Anki-Mutation-ID': options.mutationId,
        }
      : undefined,
    persistence: options?.persistence ?? {
        resourceKey,
        coalesceKey: resourceKey,
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
    serializeStudySessionRecordPayload({ ...record, id }),
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
