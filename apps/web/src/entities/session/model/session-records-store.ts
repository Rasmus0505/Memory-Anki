import type {
  DailyTrendPoint,
  SessionCompletionMethod,
  SessionKind,
  SessionKindBreakdownItem,
  TimeRecordChartRange,
  TimeRecordSummary,
  TimeSessionRecord,
} from '@/entities/session/model/session-records'
import {
  bulkDeleteStudySessionsApi,
  createStudySessionFromTimeRecordApi,
  deleteStudySessionApi,
  getStudySessionAnalyticsApi,
  listStudySessionsApi,
  patchStudySessionApi,
  type StudySessionPayload,
  type StudySessionItem,
} from '@/entities/study-session/api'
import { formatLocalDateKey, parseApiDateTime } from '@/shared/lib/dateTime'

export async function listStudySessionRecords(options: {
  limit: number
  offset: number
  keyword?: string
  kind?: SessionKind
  sortBy: 'started_at' | 'effective_seconds' | 'title'
  sortOrder: 'asc' | 'desc'
}) {
  const result = await listStudySessionsApi({ ...options, status: 'completed' })
  return {
    items: result.items.map(studySessionToTimeRecord),
    total: result.total ?? result.items.length,
    limit: result.limit ?? options.limit,
    offset: result.offset ?? options.offset,
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
    breakdown: result.breakdown,
  }
}

export async function createStudySessionRecord(record: Omit<TimeSessionRecord, 'id'> & { id?: string }) {
  const result = await createStudySessionFromTimeRecordApi({
    ...record,
    id: record.id ?? crypto.randomUUID(),
  })
  return result.item ? studySessionToTimeRecord(result.item) : null
}

export async function persistStudySessionRecord(record: TimeSessionRecord) {
  const result = await createStudySessionFromTimeRecordApi(record)
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
    clientSource: normalizeClientSource(summary.client_source),
    deletedAt: item.deleted_at,
    deletedReason: item.deleted_reason === 'manual' ? 'manual' : null,
    events: item.events as TimeSessionRecord['events'],
    sceneSegments,
  }
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
  if ('sceneSegments' in updater || 'durationEdited' in updater || 'clientSource' in updater) {
    patch.summary = {
      ...(updater.sceneSegments ? { scene_segments: updater.sceneSegments } : {}),
      ...(typeof updater.durationEdited === 'boolean' ? { duration_edited: updater.durationEdited } : {}),
      ...(updater.clientSource ? { client_source: updater.clientSource } : {}),
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

function startOfWeek(date: Date) {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  const day = normalized.getDay()
  const offset = day === 0 ? 6 : day - 1
  normalized.setDate(normalized.getDate() - offset)
  return normalized
}

function startOfDay(date: Date) {
  const normalized = new Date(date)
  normalized.setHours(0, 0, 0, 0)
  return normalized
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function formatDateKey(date: Date) {
  return formatLocalDateKey(date)
}

function formatTrendLabel(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function isOnOrAfter(date: Date, threshold: Date) {
  return date.getTime() >= threshold.getTime()
}

export function getTimeRecordSummary(records: TimeSessionRecord[], reference = new Date()): TimeRecordSummary {
  const today = startOfDay(reference)
  const tomorrow = addDays(today, 1)
  const last7DaysStart = addDays(today, -6)
  const weekStart = startOfWeek(reference)

  return records
    .filter((record) => !record.deletedAt)
    .reduce<TimeRecordSummary>(
      (accumulator, record) => {
        const startedAt = parseApiDateTime(record.startedAt)
        if (Number.isNaN(startedAt.getTime())) return accumulator
        accumulator.totalRecords += 1
        accumulator.totalEffectiveSeconds += record.effectiveSeconds
        if (startedAt >= last7DaysStart && startedAt < tomorrow) {
          accumulator.last7DaysSeconds += record.effectiveSeconds
        }
        if (startedAt >= today && startedAt < tomorrow) {
          accumulator.todaySeconds += record.effectiveSeconds
        }
        if (startedAt >= weekStart) {
          accumulator.weekPauseCount += record.pauseCount
        }
        if (!accumulator.longestSession || record.effectiveSeconds > accumulator.longestSession.effectiveSeconds) {
          accumulator.longestSession = record
        }
        return accumulator
      },
      {
        totalRecords: 0,
        totalEffectiveSeconds: 0,
        last7DaysSeconds: 0,
        todaySeconds: 0,
        weekPauseCount: 0,
        longestSession: null,
      },
    )
}

export function getDailyTrend(records: TimeSessionRecord[], days = 7, reference = new Date()): DailyTrendPoint[] {
  const safeDays = Math.max(1, days)
  const end = startOfDay(reference)
  const start = addDays(end, -(safeDays - 1))
  const totals = new Map<string, number>()

  records
    .filter((record) => !record.deletedAt)
    .forEach((record) => {
      const startedAt = parseApiDateTime(record.startedAt)
      if (Number.isNaN(startedAt.getTime()) || startedAt < start || startedAt >= addDays(end, 1)) {
        return
      }
      const dateKey = formatDateKey(startedAt)
      totals.set(dateKey, (totals.get(dateKey) ?? 0) + record.effectiveSeconds)
    })

  return Array.from({ length: safeDays }, (_, index) => {
    const date = addDays(start, index)
    const dateKey = formatDateKey(date)
    return {
      dateKey,
      label: formatTrendLabel(date),
      seconds: totals.get(dateKey) ?? 0,
    }
  })
}

export function getTimeRecordsInRange(
  records: TimeSessionRecord[],
  range: TimeRecordChartRange,
  reference = new Date(),
) {
  if (range === 'all') {
    return records.filter((record) => !record.deletedAt)
  }

  const end = addDays(startOfDay(reference), 1)
  const start = addDays(startOfDay(reference), -(range - 1))

  return records.filter((record) => {
    if (record.deletedAt) return false
    const startedAt = parseApiDateTime(record.startedAt)
    if (Number.isNaN(startedAt.getTime())) return false
    return startedAt >= start && startedAt < end
  })
}

export function getAllDailyTrend(records: TimeSessionRecord[], reference = new Date()): DailyTrendPoint[] {
  const validRecords = records
    .filter((record) => !record.deletedAt)
    .map((record) => ({
      record,
      startedAt: parseApiDateTime(record.startedAt),
    }))
    .filter(({ startedAt }) => !Number.isNaN(startedAt.getTime()))

  if (validRecords.length === 0) {
    return getDailyTrend([], 1, reference)
  }

  const today = startOfDay(reference)
  const earliest = validRecords.reduce(
    (minimum, current) => (current.startedAt < minimum ? current.startedAt : minimum),
    validRecords[0].startedAt,
  )
  const start = startOfDay(earliest)
  const safeDays = Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1)
  return getDailyTrend(records, safeDays, reference)
}

export function getTrendByRange(
  records: TimeSessionRecord[],
  range: TimeRecordChartRange,
  reference = new Date(),
) {
  if (range === 'all') {
    return getAllDailyTrend(records, reference)
  }
  return getDailyTrend(records, range, reference)
}

export function getSessionKindBreakdown(
  records: TimeSessionRecord[],
  range: TimeRecordChartRange = 'all',
  reference = new Date(),
): SessionKindBreakdownItem[] {
  const accumulator = new Map<SessionKind, SessionKindBreakdownItem>()

  getTimeRecordsInRange(records, range, reference).forEach((record) => {
    const current = accumulator.get(record.kind) ?? {
      kind: record.kind,
      label: formatSessionKind(record.kind),
      seconds: 0,
      sessions: 0,
    }
    current.seconds += record.effectiveSeconds
    current.sessions += 1
    accumulator.set(record.kind, current)
  })

  return ['review', 'practice', 'quiz', 'palace_edit'].map((kind) =>
    accumulator.get(kind as SessionKind) ?? {
      kind: kind as SessionKind,
      label: formatSessionKind(kind as SessionKind),
      seconds: 0,
      sessions: 0,
    },
  )
}

export function getWeeklyLocalSessionStats(records: TimeSessionRecord[], reference = new Date()) {
  const threshold = startOfWeek(reference)

  return records.reduce(
    (accumulator, record) => {
      const startedAt = parseApiDateTime(record.startedAt)
      if (record.deletedAt || Number.isNaN(startedAt.getTime()) || !isOnOrAfter(startedAt, threshold)) {
        return accumulator
      }
      if (record.kind === 'review') {
        accumulator.reviewCount += 1
        accumulator.reviewDurationSeconds += record.effectiveSeconds
      }
      if (record.kind === 'practice') {
        accumulator.practiceDurationSeconds += record.effectiveSeconds
      }
      if (record.kind === 'quiz') {
        accumulator.quizDurationSeconds += record.effectiveSeconds
      }
      if (record.kind === 'palace_edit') {
        accumulator.editDurationSeconds += record.effectiveSeconds
      }
      return accumulator
    },
    {
      reviewCount: 0,
      reviewDurationSeconds: 0,
      practiceDurationSeconds: 0,
      quizDurationSeconds: 0,
      editDurationSeconds: 0,
    },
  )
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

export function formatSessionKind(kind: SessionKind) {
  if (kind === 'palace_edit') return '宫殿编辑'
  if (kind === 'practice') return '练习'
  if (kind === 'quiz') return '做题'
  return '正式复习'
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
  return '离开页面'
}

/**
 * 一次性清理：练习进度已服务端化（见 app/router/practiceRouteSupport.tsx），
 * 移除两台设备浏览器中残留的旧 localStorage 键。清理逻辑保留至 2026-10 后可整体删除。
 */
export function cleanupLegacyPracticeProgressStorage() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem('memory-anki.practice-progress.v1')
  } catch {
    // localStorage 不可用时静默跳过
  }
}
