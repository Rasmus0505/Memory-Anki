export type RevealState = 'hidden' | 'placeholder' | 'revealed'

export type SessionKind = 'palace_edit' | 'practice' | 'review'

export type SessionCompletionMethod =
  | 'manual_complete'
  | 'auto_complete'
  | 'restart'
  | 'left_page'
  | 'saved'

export type SessionEventType =
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'adjust_duration'
  | 'enter_edit_mode'
  | 'exit_edit_mode'
  | 'restart'
  | 'auto_complete'
  | 'manual_complete'

export interface SessionEventRecord {
  type: SessionEventType
  at: string
  meta?: Record<string, boolean | number | string | null>
}

export interface TimeSessionRecord {
  id: string
  kind: SessionKind
  palaceId: number | null
  title: string
  startedAt: string
  endedAt: string
  effectiveSeconds: number
  pauseCount: number
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
  deletedAt?: string | null
  deletedReason?: 'manual' | null
  events: SessionEventRecord[]
}

export interface TimeRecordSummary {
  totalRecords: number
  totalEffectiveSeconds: number
  last7DaysSeconds: number
  todaySeconds: number
  weekPauseCount: number
  longestSession: TimeSessionRecord | null
}

export interface DailyTrendPoint {
  dateKey: string
  label: string
  seconds: number
}

export interface SessionKindBreakdownItem {
  kind: SessionKind
  label: string
  seconds: number
  sessions: number
}

interface TimeRecordListOptions {
  includeDeleted?: boolean
  includeBelowThreshold?: boolean
}

type TimeRecordMutation = Omit<TimeSessionRecord, 'id'> & { id?: string }

export interface PracticeProgressRecord {
  palaceId: number
  updatedAt: string
  completed: boolean
  revealMap: Record<string, RevealState>
  redNodeIds: string[]
}

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

export function readTimeRecords() {
  return readLocalStorage<TimeSessionRecord[]>(TIME_RECORDS_KEY, [])
}

export function getTimeRecordingThresholdSeconds() {
  const raw = readLocalStorage<number | string>(TIME_RECORDING_THRESHOLD_SECONDS_KEY, 0)
  const parsed = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isNaN(parsed) || parsed < 0) return 0
  return Math.round(parsed)
}

export function setTimeRecordingThresholdSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds))
  writeLocalStorage(TIME_RECORDING_THRESHOLD_SECONDS_KEY, safeSeconds)
  return safeSeconds
}

export function isTimeRecordAboveThreshold(recordOrSeconds: TimeSessionRecord | number, thresholdSeconds = getTimeRecordingThresholdSeconds()) {
  const effectiveSeconds =
    typeof recordOrSeconds === 'number' ? recordOrSeconds : recordOrSeconds.effectiveSeconds
  return effectiveSeconds > thresholdSeconds
}

function normalizeTimeRecord(record: TimeSessionRecord): TimeSessionRecord {
  return {
    ...record,
    deletedAt: record.deletedAt ?? null,
    deletedReason: record.deletedReason ?? null,
  }
}

function sortTimeRecords(records: TimeSessionRecord[]) {
  return [...records].sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

function writeTimeRecords(records: TimeSessionRecord[]) {
  writeLocalStorage(TIME_RECORDS_KEY, sortTimeRecords(records).map(normalizeTimeRecord))
}

function filterActiveRecords(records: TimeSessionRecord[]) {
  return records.filter((record) => !record.deletedAt)
}

function filterAboveThresholdRecords(records: TimeSessionRecord[], thresholdSeconds = getTimeRecordingThresholdSeconds()) {
  return records.filter((record) => isTimeRecordAboveThreshold(record, thresholdSeconds))
}

export function listTimeRecords(options: TimeRecordListOptions = {}) {
  const records = sortTimeRecords(readTimeRecords().map(normalizeTimeRecord))
  const visibleRecords = options.includeDeleted ? records : filterActiveRecords(records)
  return options.includeBelowThreshold ? visibleRecords : filterAboveThresholdRecords(visibleRecords)
}

export function createTimeRecord(record: TimeRecordMutation) {
  const nextRecord = normalizeTimeRecord({
    ...record,
    id: record.id ?? crypto.randomUUID(),
  })
  if (!isTimeRecordAboveThreshold(nextRecord)) {
    return null
  }
  writeTimeRecords([...readTimeRecords(), nextRecord])
  return nextRecord
}

export function appendTimeRecord(record: TimeSessionRecord) {
  return createTimeRecord(record)
}

export function updateTimeRecord(id: string, updater: Partial<TimeSessionRecord>) {
  const records = readTimeRecords()
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) return null

  const nextRecord = normalizeTimeRecord({
    ...records[index],
    ...updater,
    id,
  })
  records[index] = nextRecord
  writeTimeRecords(records)
  return nextRecord
}

export function softDeleteTimeRecord(id: string) {
  return updateTimeRecord(id, {
    deletedAt: new Date().toISOString(),
    deletedReason: 'manual',
  })
}

export function restoreTimeRecord(id: string) {
  return updateTimeRecord(id, {
    deletedAt: null,
    deletedReason: null,
  })
}

export function groupTimeRecordsByDate(records: TimeSessionRecord[]) {
  return filterAboveThresholdRecords(filterActiveRecords(records)).reduce<Record<string, TimeSessionRecord[]>>((accumulator, record) => {
    const dateKey = record.startedAt.slice(0, 10)
    accumulator[dateKey] = accumulator[dateKey] ?? []
    accumulator[dateKey].push(record)
    return accumulator
  }, {})
}

export function getTimeRecordSummary(records: TimeSessionRecord[], reference = new Date()): TimeRecordSummary {
  const today = startOfDay(reference)
  const tomorrow = addDays(today, 1)
  const last7DaysStart = addDays(today, -6)
  const weekStart = startOfWeek(reference)
  const activeRecords = filterAboveThresholdRecords(filterActiveRecords(records))

  return activeRecords.reduce<TimeRecordSummary>(
    (accumulator, record) => {
      const startedAt = new Date(record.startedAt)
      if (Number.isNaN(startedAt.getTime())) {
        return accumulator
      }

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

  filterAboveThresholdRecords(filterActiveRecords(records)).forEach((record) => {
    const startedAt = new Date(record.startedAt)
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

export function getSessionKindBreakdown(records: TimeSessionRecord[]): SessionKindBreakdownItem[] {
  const accumulator = new Map<SessionKind, SessionKindBreakdownItem>()

  filterAboveThresholdRecords(filterActiveRecords(records)).forEach((record) => {
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

  return ['review', 'practice', 'palace_edit'].map((kind) =>
    accumulator.get(kind as SessionKind) ?? {
      kind: kind as SessionKind,
      label: formatSessionKind(kind as SessionKind),
      seconds: 0,
      sessions: 0,
    },
  )
}

export function getWeeklyLocalSessionStats(reference = new Date()) {
  const records = listTimeRecords()
  const threshold = startOfWeek(reference)

  return records.reduce(
    (accumulator, record) => {
      const startedAt = new Date(record.startedAt)
      if (Number.isNaN(startedAt.getTime()) || !isOnOrAfter(startedAt, threshold)) {
        return accumulator
      }

      if (record.kind === 'review') {
        accumulator.reviewCount += 1
        accumulator.reviewDurationSeconds += record.effectiveSeconds
      }
      if (record.kind === 'practice') {
        accumulator.practiceDurationSeconds += record.effectiveSeconds
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
      editDurationSeconds: 0,
    },
  )
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}小时 ${minutes}分`
  }
  if (minutes > 0) {
    return `${minutes}分 ${remainSeconds}秒`
  }
  return `${remainSeconds}秒`
}

export function formatSessionKind(kind: SessionKind) {
  if (kind === 'palace_edit') return '宫殿编辑'
  if (kind === 'practice') return '练习'
  return '正式复习'
}

export function formatCompletionMethod(method: SessionCompletionMethod) {
  if (method === 'manual_complete') return '手动完成'
  if (method === 'auto_complete') return '自动完成'
  if (method === 'restart') return '重新开始'
  if (method === 'saved') return '保存结束'
  return '离开页面'
}
