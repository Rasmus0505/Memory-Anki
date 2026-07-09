import type { TimeRecordChartRange } from '@/entities/session/model'

export const DASHBOARD_TOTAL_DURATION_FILTER_STORAGE_KEY =
  'memory_anki_dashboard_total_duration_filter'

export type DurationFilterMode = 'month' | 'range' | 'all'

export interface DashboardDurationFilterState {
  mode: DurationFilterMode
  month: string
  startDate: string
  endDate: string
  trendRangeDays?: TimeRecordChartRange
  breakdownRangeDays?: TimeRecordChartRange
}

export interface NormalizedDashboardDurationFilterState
  extends Omit<
    DashboardDurationFilterState,
    'trendRangeDays' | 'breakdownRangeDays'
  > {
  trendRangeDays: TimeRecordChartRange
  breakdownRangeDays: TimeRecordChartRange
}

export const DEFAULT_TIME_RECORD_CHART_RANGE: TimeRecordChartRange = 7

export const TIME_RECORD_CHART_RANGE_OPTIONS: Array<{
  label: string
  value: TimeRecordChartRange
}> = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '全部', value: 'all' },
]

export function isTimeRecordChartRange(value: unknown): value is TimeRecordChartRange {
  return value === 7 || value === 30 || value === 90 || value === 'all'
}

export function getCurrentMonthValue(reference = new Date()) {
  const year = reference.getFullYear()
  const month = `${reference.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

export function createDefaultDurationFilterState(reference = new Date()): DashboardDurationFilterState {
  return {
    mode: 'month',
    month: getCurrentMonthValue(reference),
    startDate: '',
    endDate: '',
    trendRangeDays: DEFAULT_TIME_RECORD_CHART_RANGE,
    breakdownRangeDays: DEFAULT_TIME_RECORD_CHART_RANGE,
  }
}

export function isDashboardDurationFilterState(value: unknown): value is DashboardDurationFilterState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DashboardDurationFilterState>
  if (candidate.mode !== 'month' && candidate.mode !== 'range' && candidate.mode !== 'all') return false
  if (typeof candidate.month !== 'string') return false
  if (typeof candidate.startDate !== 'string') return false
  if (typeof candidate.endDate !== 'string') return false
  if (
    typeof candidate.trendRangeDays !== 'undefined' &&
    !isTimeRecordChartRange(candidate.trendRangeDays)
  ) {
    return false
  }
  if (
    typeof candidate.breakdownRangeDays !== 'undefined' &&
    !isTimeRecordChartRange(candidate.breakdownRangeDays)
  ) {
    return false
  }
  return true
}

export function normalizeDashboardDurationFilterState(
  value: DashboardDurationFilterState,
  reference = new Date(),
): NormalizedDashboardDurationFilterState {
  const defaults = createDefaultDurationFilterState(reference)
  return {
    mode: value.mode,
    month: value.month,
    startDate: value.startDate,
    endDate: value.endDate,
    trendRangeDays: isTimeRecordChartRange(value.trendRangeDays)
      ? value.trendRangeDays
      : defaults.trendRangeDays ?? DEFAULT_TIME_RECORD_CHART_RANGE,
    breakdownRangeDays: isTimeRecordChartRange(value.breakdownRangeDays)
      ? value.breakdownRangeDays
      : defaults.breakdownRangeDays ?? DEFAULT_TIME_RECORD_CHART_RANGE,
  }
}

export function isDefaultDurationFilterState(filter: DashboardDurationFilterState) {
  return (
    filter.mode === 'month' &&
    filter.month === getCurrentMonthValue() &&
    filter.startDate === '' &&
    filter.endDate === ''
  )
}

export function formatSelectedDurationLabel(mode: DurationFilterMode, month: string, startDate: string, endDate: string) {
  if (mode === 'month') return month || '当前月份'
  if (mode === 'all') return '全部'
  if (startDate && endDate) return `${startDate} 至 ${endDate}`
  if (startDate) return `${startDate} 至`
  if (endDate) return `至 ${endDate}`
  return '请选择时间范围'
}

export function formatTrendCardTitle(range: TimeRecordChartRange) {
  if (range === 'all') return '全部趋势'
  return `最近 ${range} 天趋势`
}

export function hasDurationFilterStateChanged(
  current: DashboardDurationFilterState,
  normalized: NormalizedDashboardDurationFilterState,
) {
  return (
    current.mode !== normalized.mode ||
    current.month !== normalized.month ||
    current.startDate !== normalized.startDate ||
    current.endDate !== normalized.endDate ||
    current.trendRangeDays !== normalized.trendRangeDays ||
    current.breakdownRangeDays !== normalized.breakdownRangeDays
  )
}
