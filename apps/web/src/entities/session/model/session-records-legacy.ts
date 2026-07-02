import type {
  DailyTrendPoint,
  PracticeProgressRecord,
  SessionCompletionMethod,
  SessionKind,
  SessionKindBreakdownItem,
  TimeRecordChartRange,
  TimeRecordSummary,
  TimeSessionRecord,
} from '@/entities/session/model/session-records'
import {
  createTimeRecordApi,
  getTimeRecordingThresholdApi,
  importLegacyTimeRecordsApi,
  listTimeRecordsApi,
  restoreTimeRecordApi,
  setTimeRecordingThresholdApi,
  softDeleteTimeRecordApi,
  updateTimeRecordApi,
} from '@/entities/session/api'
import { parseApiDateTime } from '@/shared/lib/dateTime'

const PRACTICE_PROGRESS_KEY = 'memory-anki.practice-progress.v1'
const TIME_RECORDS_KEY = 'memory-anki.time-records.v1'
const TIME_RECORDING_THRESHOLD_SECONDS_KEY = 'memory-anki.time-recording-threshold-seconds.v1'

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function readLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  return safeParse(window.localStorage.getItem(key), fallback)
}

function writeLocalStorage<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function readPracticeProgressMap() {
  return readLocalStorage<Record<string, PracticeProgressRecord>>(PRACTICE_PROGRESS_KEY, {})
}

export function getPracticeProgress(palaceId: number) {
  const store = readPracticeProgressMap()
  return store[String(palaceId)] ?? null
}

export function savePracticeProgress(record: PracticeProgressRecord) {
  const store = readPracticeProgressMap()
  store[String(record.palaceId)] = record
  writeLocalStorage(PRACTICE_PROGRESS_KEY, store)
}

export function clearPracticeProgress(palaceId: number) {
  const store = readPracticeProgressMap()
  delete store[String(palaceId)]
  writeLocalStorage(PRACTICE_PROGRESS_KEY, store)
}

export function readLegacyTimeRecords() {
  return readLocalStorage<TimeSessionRecord[]>(TIME_RECORDS_KEY, [])
}

export async function migrateLegacyTimeRecordsToBackend() {
  const records = readLegacyTimeRecords()
  if (records.length === 0) return 0
  const result = await importLegacyTimeRecordsApi(records)
  window.localStorage.removeItem(TIME_RECORDS_KEY)
  return result.imported
}

export async function listTimeRecords(options?: { includeDeleted?: boolean; includeBelowThreshold?: boolean }) {
  const result = await listTimeRecordsApi(options)
  return result.items
}

export async function createTimeRecord(record: Omit<TimeSessionRecord, 'id'> & { id?: string }) {
  const result = await createTimeRecordApi({
    ...record,
    id: record.id ?? crypto.randomUUID(),
  })
  return result.item
}

export async function appendTimeRecord(record: TimeSessionRecord) {
  const result = await createTimeRecordApi(record)
  return result.item
}

export async function updateTimeRecord(id: string, updater: Partial<TimeSessionRecord>) {
  const result = await updateTimeRecordApi(id, updater)
  return result.item
}

export async function softDeleteTimeRecord(id: string) {
  const result = await softDeleteTimeRecordApi(id)
  return result.item
}

export async function restoreTimeRecord(id: string) {
  const result = await restoreTimeRecordApi(id)
  return result.item
}

export async function getTimeRecordingThresholdSeconds() {
  const result = await getTimeRecordingThresholdApi()
  return result.seconds
}

export async function setTimeRecordingThresholdSeconds(seconds: number) {
  const result = await setTimeRecordingThresholdApi(seconds)
  window.localStorage.removeItem(TIME_RECORDING_THRESHOLD_SECONDS_KEY)
  return result.seconds
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
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
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

export function formatCompletionMethod(method: SessionCompletionMethod) {
  if (method === 'manual_complete') return '手动完成'
  if (method === 'auto_complete') return '自动完成'
  if (method === 'restart') return '重新开始'
  if (method === 'saved') return '保存结束'
  return '离开页面'
}
