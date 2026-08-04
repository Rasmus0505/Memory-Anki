import type {
  TimeRecordKind,
  TimeRecordRangeMode,
} from '@/modules/session/domain/study-session-entity/api'
import type {
  TimeRecordSortBy,
  TimeRecordSortOrder,
} from '@/modules/session/domain/session-entity/model/session-records'

export const TIME_RECORD_FILTER_STORAGE_KEY =
  'memory_anki_dashboard_total_duration_filter'

export interface TimeRecordFilterState {
  version: 2
  rangeMode: TimeRecordRangeMode
  month: string
  rollingDays: 7 | 30 | 90
  startDate: string
  endDate: string
  keyword: string
  kind: 'all' | TimeRecordKind
  sortBy: TimeRecordSortBy
  sortOrder: TimeRecordSortOrder
  pageSize: number
}

export type TimeRecordFilterPersistenceState = TimeRecordFilterState

const RANGE_MODES: TimeRecordRangeMode[] = [
  'month',
  'rolling',
  'custom',
  'all',
]
const KINDS: TimeRecordKind[] = [
  'review',
  'practice',
  'quiz',
  'palace_edit',
  'english',
  'english_reading',
  'custom',
]
const SORT_FIELDS: TimeRecordSortBy[] = [
  'started_at',
  'effective_seconds',
  'title',
]
const PAGE_SIZES = [20, 50, 100]

export function getCurrentMonthValue(reference = new Date()) {
  const year = reference.getFullYear()
  const month = `${reference.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

export function createDefaultTimeRecordFilter(
  reference = new Date(),
): TimeRecordFilterState {
  return {
    version: 2,
    rangeMode: 'month',
    month: getCurrentMonthValue(reference),
    rollingDays: 30,
    startDate: '',
    endDate: '',
    keyword: '',
    kind: 'all',
    sortBy: 'started_at',
    sortOrder: 'desc',
    pageSize: 20,
  }
}

export function isTimeRecordFilterPersistenceState(
  value: unknown,
): value is TimeRecordFilterPersistenceState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TimeRecordFilterState>
  return candidate.version === 2
}

export function normalizeTimeRecordFilter(
  value: TimeRecordFilterPersistenceState | null | undefined,
  reference = new Date(),
): TimeRecordFilterState {
  const defaults = createDefaultTimeRecordFilter(reference)
  if (!value) return defaults

  return {
    version: 2,
    rangeMode: RANGE_MODES.includes(value.rangeMode)
      ? value.rangeMode
      : defaults.rangeMode,
    month: isMonthValue(value.month) ? value.month : defaults.month,
    rollingDays:
      value.rollingDays === 7 ||
      value.rollingDays === 30 ||
      value.rollingDays === 90
        ? value.rollingDays
        : defaults.rollingDays,
    startDate: isDateValue(value.startDate) ? value.startDate : '',
    endDate: isDateValue(value.endDate) ? value.endDate : '',
    keyword: typeof value.keyword === 'string' ? value.keyword : '',
    kind:
      value.kind === 'all' || KINDS.includes(value.kind)
        ? value.kind
        : defaults.kind,
    sortBy: SORT_FIELDS.includes(value.sortBy)
      ? value.sortBy
      : defaults.sortBy,
    sortOrder:
      value.sortOrder === 'asc' || value.sortOrder === 'desc'
        ? value.sortOrder
        : defaults.sortOrder,
    pageSize: PAGE_SIZES.includes(value.pageSize)
      ? value.pageSize
      : defaults.pageSize,
  }
}

export function isTimeRecordCustomRangeValid(
  filter: Pick<TimeRecordFilterState, 'rangeMode' | 'startDate' | 'endDate'>,
) {
  if (filter.rangeMode !== 'custom') return true
  return Boolean(
    isDateValue(filter.startDate) &&
      isDateValue(filter.endDate) &&
      filter.startDate <= filter.endDate,
  )
}

export function formatTimeRecordRangeLabel(filter: TimeRecordFilterState) {
  if (filter.rangeMode === 'month') return filter.month || '当前月份'
  if (filter.rangeMode === 'rolling') return `最近 ${filter.rollingDays} 天`
  if (filter.rangeMode === 'all') return '全部历史'
  if (filter.startDate && filter.endDate) {
    return `${filter.startDate} 至 ${filter.endDate}`
  }
  return '请选择日期范围'
}

function isMonthValue(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
}

function isDateValue(value: unknown): value is string {
  return value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
}
