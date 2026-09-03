import type {
  SessionCompletionMethod,
  SessionKind,
  TimeRecordChartRange,
  TimeSessionRecord,
} from '@/modules/session/domain/session-entity/model/session-records'
import {
  bulkDeleteStudySessionsApi,
  createStudySessionFromTimeRecordApi,
  deleteStudySessionApi,
  getStudySessionAnalyticsApi,
  getTimeRecordReadModelApi,
  listStudySessionsApi,
  patchStudySessionApi,
  serializeStudySessionRecordPayload,
  type StudySessionPayload,
  type StudySessionItem,
  type TimeRecordKind,
  type TimeRecordRangeMode,
} from '@/modules/session/domain/study-session-entity/api'

export interface TimeRecordSourceSummary {
  totalEffectiveSeconds: number
  desktopEffectiveSeconds: number
  pwaEffectiveSeconds: number
  unknownEffectiveSeconds: number
}

export interface UnifiedTimeRecordReadOptions {
  rangeMode: TimeRecordRangeMode
  month?: string
  rollingDays?: 7 | 30 | 90
  startDate?: string
  endDate?: string
  keyword?: string
  kind?: TimeRecordKind
  sortBy: 'started_at' | 'effective_seconds' | 'title'
  sortOrder: 'asc' | 'desc'
  limit: number
  offset: number
}

export async function readUnifiedTimeRecords(options: UnifiedTimeRecordReadOptions) {
  const result = await getTimeRecordReadModelApi(options)
  return {
    items: result.items.map(studySessionToTimeRecord),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    range: {
      mode: result.range.mode,
      month: result.range.month,
      rollingDays: result.range.rolling_days,
      startDate: result.range.start_date,
      endDate: result.range.end_date,
    },
    sourceSummary: {
      totalEffectiveSeconds: result.summary.total_effective_seconds,
      desktopEffectiveSeconds: result.summary.desktop_effective_seconds,
      pwaEffectiveSeconds: result.summary.pwa_effective_seconds,
      unknownEffectiveSeconds: result.summary.unknown_effective_seconds,
    },
    recordCount: result.summary.record_count,
    trend: result.trend.map((item) => ({
      dateKey: item.date_key,
      label: item.label,
      seconds: item.seconds,
      records: item.records,
    })),
    breakdown: result.kind_breakdown.map((item) => ({
      kind: item.kind,
      label: item.label,
      seconds: item.seconds,
      sessions: item.sessions,
      isBuiltin: item.is_builtin,
    })),
  }
}

export async function listStudySessionRecords(options: {
  limit: number
  offset: number
  keyword?: string
  kind?: SessionKind
  sortBy: 'started_at' | 'effective_seconds' | 'title'
  sortOrder: 'asc' | 'desc'
  startedFrom?: string | null
  startedTo?: string | null
  includeSourceSummary?: boolean
}) {
  const result = await listStudySessionsApi({
    ...options,
    kind: options.kind === 'custom' ? 'custom' : options.kind,
    status: 'completed',
    startedFrom: options.startedFrom ?? undefined,
    startedTo: options.startedTo ?? undefined,
    includeSourceSummary: options.includeSourceSummary,
  })
  const sourceSummary = result.source_summary
    ? {
        totalEffectiveSeconds: result.source_summary.total_effective_seconds,
        desktopEffectiveSeconds: result.source_summary.desktop_effective_seconds,
        pwaEffectiveSeconds: result.source_summary.pwa_effective_seconds,
        unknownEffectiveSeconds: result.source_summary.unknown_effective_seconds,
      }
    : null
  return {
    items: result.items.map(studySessionToTimeRecord),
    total: result.total ?? result.items.length,
    limit: result.limit ?? options.limit,
    offset: result.offset ?? options.offset,
    sourceSummary,
  }
}

export async function getStudySessionRecordAnalytics(options: {
  trendRange: TimeRecordChartRange
  breakdownRange: TimeRecordChartRange
}) {
  const result = await getStudySessionAnalyticsApi(options)
  return {
    trend: result.trend.map((item) => ({
      dateKey: item.date_key,
      label: item.label,
      seconds: item.seconds,
    })),
    breakdown: result.breakdown.map((item) => ({
      kind: item.kind,
      label: item.label,
      seconds: item.seconds,
      sessions: item.sessions,
      isBuiltin: item.is_builtin ?? ['review', 'practice', 'quiz', 'palace_edit'].includes(item.kind),
    })),
  }
}

export async function createStudySessionRecord(record: Omit<TimeSessionRecord, 'id'> & { id?: string }) {
  const id = record.id ?? crypto.randomUUID()
  const result = await createStudySessionFromTimeRecordApi({
    ...serializeStudySessionRecordPayload({ ...record, id }),
  })
  return result.item ? studySessionToTimeRecord(result.item) : null
}

export async function persistStudySessionRecord(record: TimeSessionRecord) {
  const result = await createStudySessionFromTimeRecordApi(
    serializeStudySessionRecordPayload(record),
  )
  return result.item ? studySessionToTimeRecord(result.item) : null
}

export async function updateStudySessionRecord(id: string, updater: Partial<TimeSessionRecord>) {
  const result = await patchStudySessionApi(id, timeRecordPatchToStudySessionPatch(updater))
  return result.item ? studySessionToTimeRecord(result.item) : null
}

export async function deleteStudySessionRecord(id: string) {
  await deleteStudySessionApi(id)
  return { ok: true }
}

export async function bulkDeleteStudySessionRecords(ids: string[]) {
  return bulkDeleteStudySessionsApi(ids)
}

function studySessionToTimeRecord(item: StudySessionItem): TimeSessionRecord {
  const summary = item.summary || {}
  const sceneSegments = readSceneSegments(summary)
  const activityTag = readOptionalString(summary.activity_tag)
  const activityTagLabel = readOptionalString(summary.activity_tag_label)
  return {
    id: item.id,
    sessionKey: item.session_key ?? null,
    clientRevision: Math.max(0, Math.round(item.client_revision ?? 0)),
    operationId: item.operation_id ?? item.last_operation_id ?? null,
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
    clientSource: normalizeClientSource(summary.client_source),
    activityTag,
    activityTagLabel,
    importedFrom: readOptionalString(summary.migrated_from),
    deletedAt: item.deleted_at,
    deletedReason: item.deleted_reason === 'manual' ? 'manual' : null,
    events: item.events as TimeSessionRecord['events'],
    sceneSegments,
  }
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeClientSource(value: unknown): TimeSessionRecord['clientSource'] {
  if (value === 'desktop') return 'desktop'
  if (value === 'pwa' || value === 'mobile') return 'pwa'
  return null
}

function readSceneSegments(summary: Record<string, unknown>): TimeSessionRecord['sceneSegments'] {
  const value = summary.scene_segments
  return Array.isArray(value) ? value as TimeSessionRecord['sceneSegments'] : []
}

function studySceneToSessionKind(scene: string): SessionKind {
  if (scene === 'palace_edit') return 'palace_edit'
  if (scene === 'quiz') return 'quiz'
  if (
    scene === 'review' ||
    scene === 'formal_unit_review' ||
    scene === 'freestyle_unit_review' ||
    scene === 'segment_review' ||
    scene === 'mini_review'
  ) return 'review'
  if (scene === 'custom') return 'custom'
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
  if ('sessionKey' in updater) patch.session_key = updater.sessionKey ?? null
  if ('clientRevision' in updater && updater.clientRevision != null) {
    patch.client_revision = Math.max(0, Math.round(updater.clientRevision))
  }
  if ('operationId' in updater) patch.operation_id = updater.operationId ?? null
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
  const touchSummary =
    'sceneSegments' in updater ||
    'durationEdited' in updater ||
    'clientSource' in updater ||
    'activityTag' in updater ||
    'activityTagLabel' in updater
  if (touchSummary) {
    patch.summary = {
      ...(updater.sceneSegments ? { scene_segments: updater.sceneSegments } : {}),
      ...(typeof updater.durationEdited === 'boolean' ? { duration_edited: updater.durationEdited } : {}),
      ...(updater.clientSource ? { client_source: updater.clientSource } : {}),
      ...('activityTag' in updater
        ? { activity_tag: updater.activityTag ?? null }
        : {}),
      ...('activityTagLabel' in updater
        ? { activity_tag_label: updater.activityTagLabel ?? null }
        : {}),
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
  if (kind === 'custom') return 'custom'
  return 'practice'
}

export function formatTimeRecordTagLabel(
  record: Pick<
    TimeSessionRecord,
    | 'kind'
    | 'title'
    | 'sourceKind'
    | 'palaceId'
    | 'englishCourseId'
    | 'activityTag'
    | 'activityTagLabel'
    | 'sceneSegments'
  >,
) {
  const routeLabel = resolveTimeRecordRouteLabel(record)
  const behaviorLabel = resolveTimeRecordBehaviorLabel(record)
  return routeLabel ? `${routeLabel}-${behaviorLabel}` : behaviorLabel
}

function resolveTimeRecordBehaviorLabel(
  record: Pick<TimeSessionRecord, 'kind' | 'activityTag' | 'activityTagLabel'>,
) {
  if (record.activityTagLabel?.trim()) return record.activityTagLabel.trim()
  if (record.activityTag?.trim()) {
    const tag = record.activityTag.trim()
    if (tag === 'review' || tag === 'practice' || tag === 'quiz' || tag === 'palace_edit') {
      return formatTimeRecordBehavior(tag)
    }
    return tag
  }
  return formatTimeRecordBehavior(record.kind)
}

function formatTimeRecordBehavior(kind: SessionKind | string) {
  if (kind === 'practice' || kind === 'review') return '翻卡'
  return formatSessionKind(kind)
}

function resolveTimeRecordRouteLabel(
  record: Pick<
    TimeSessionRecord,
    'kind' | 'title' | 'sourceKind' | 'palaceId' | 'englishCourseId' | 'sceneSegments'
  >,
) {
  const scene = record.sceneSegments?.at(-1)?.scene
  if (scene === 'freestyle' || /随心/.test(record.title)) return '随心'
  if (scene === 'english_reading' || record.sourceKind === 'english_reading') return '英语阅读'
  if (scene === 'english' || record.sourceKind === 'english' || record.englishCourseId != null) {
    return '英语'
  }
  if (scene === 'quiz') return '宫殿'
  if (scene === 'review') return '复习'
  if (scene === 'practice' || record.sourceKind === 'palace' || record.palaceId != null) {
    return '宫殿'
  }
  if (scene === 'palace_edit' || record.kind === 'palace_edit') return '宫殿'
  return null
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = seconds % 60

  if (hours > 0) return `${hours}小时 ${minutes}分`
  if (minutes > 0) return `${minutes}分 ${remainSeconds}秒`
  return `${remainSeconds}秒`
}

export function formatSessionKind(kind: SessionKind | string) {
  if (kind === 'palace_edit') return '宫殿编辑'
  if (kind === 'practice') return '练习'
  if (kind === 'quiz') return '做题'
  if (kind === 'custom') return '其他'
  if (kind === 'review') return '正式复习'
  return String(kind || '其他')
}

export function formatSessionSource(record: Pick<TimeSessionRecord, 'sourceKind' | 'englishCourseId' | 'palaceId'>) {
  if (record.sourceKind === 'english_reading') {
    return '英语阅读'
  }
  if (record.sourceKind === 'english' || record.englishCourseId != null) {
    return '英语听力'
  }
  if (record.sourceKind === 'palace' || record.palaceId != null) {
    return '宫殿学习'
  }
  return '未分类'
}

export function formatClientSource(source: TimeSessionRecord['clientSource']) {
  if (source === 'desktop') return '电脑端'
  if (source === 'pwa') return 'PWA 端'
  return '未知端'
}

export function formatCompletionMethod(method: SessionCompletionMethod) {
  if (method === 'manual_complete') return '手动完成'
  if (method === 'auto_complete') return '自动完成'
  if (method === 'restart') return '重新开始'
  if (method === 'saved') return '保存结束'
  if (method === 'all_units_passed') return '单元复习完成'
  return '离开页面'
}
