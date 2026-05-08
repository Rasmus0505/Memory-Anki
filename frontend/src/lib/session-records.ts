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
  events: SessionEventRecord[]
}

export interface PracticeProgressRecord {
  palaceId: number
  updatedAt: string
  completed: boolean
  revealMap: Record<string, RevealState>
  redNodeIds: string[]
}

const PRACTICE_PROGRESS_KEY = 'memory-anki.practice-progress.v1'
const TIME_RECORDS_KEY = 'memory-anki.time-records.v1'

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

export function appendTimeRecord(record: TimeSessionRecord) {
  const next = [...readTimeRecords(), record].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  )
  writeLocalStorage(TIME_RECORDS_KEY, next)
}

export function groupTimeRecordsByDate(records: TimeSessionRecord[]) {
  return records.reduce<Record<string, TimeSessionRecord[]>>((accumulator, record) => {
    const dateKey = record.startedAt.slice(0, 10)
    accumulator[dateKey] = accumulator[dateKey] ?? []
    accumulator[dateKey].push(record)
    return accumulator
  }, {})
}

export function getWeeklyLocalSessionStats(reference = new Date()) {
  const records = readTimeRecords()
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
