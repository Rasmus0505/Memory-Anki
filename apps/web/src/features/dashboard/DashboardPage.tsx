import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Clock3, Plus, Sparkles, Timer, TrendingUp } from 'lucide-react'
import { DashboardSkeleton } from './DashboardSkeleton'
import type { DashboardQuery, DashboardResponse } from '@/shared/api/contracts'
import { TimeRecordDialog } from '@/features/profile/components/TimeRecordDialog'
import { TimeRecordsBreakdownChart } from '@/features/profile/components/TimeRecordsBreakdownChart'
import { TimeRecordsTable } from '@/features/profile/components/TimeRecordsTable'
import { TimeRecordsTrendChart } from '@/features/profile/components/TimeRecordsTrendChart'
import { getTimeRecordChartColor } from '@/features/profile/model/time-record-chart'
import { useTimeRecordsDashboard } from '@/features/profile/hooks/useTimeRecordsDashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { formatDuration, type TimeRecordChartRange } from '@/entities/session/model'
import { getDashboardApi } from '@/features/dashboard/api'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { cn } from '@/shared/lib/utils'

const DASHBOARD_TOTAL_DURATION_FILTER_STORAGE_KEY =
  'memory_anki_dashboard_total_duration_filter'

function formatLearningTooltip(item: DashboardResponse['today_learning_palaces'][number]) {
  const lines = [
    `${item.palace_title || '未命名宫殿'}`,
    `总时长：${formatDuration(item.total_seconds)}`,
    `宫殿编辑：${formatDuration(item.palace_edit_seconds)}`,
    `练习：${formatDuration(item.practice_seconds)}`,
    `复习：${formatDuration(item.review_seconds)}`,
  ]
  if (item.quiz_seconds > 0) {
    lines.splice(4, 0, `做题：${formatDuration(item.quiz_seconds)}`)
  }
  return lines.join('\n')
}

const dashboardLearningLegend = [
  { key: 'palace_edit', label: '宫殿编辑', color: getTimeRecordChartColor('palace_edit') },
  { key: 'practice', label: '练习', color: getTimeRecordChartColor('practice') },
  { key: 'quiz', label: '做题', color: getTimeRecordChartColor('quiz') },
  { key: 'review', label: '复习', color: getTimeRecordChartColor('review') },
] as const

function buildLearningSegments(item: DashboardResponse['today_learning_palaces'][number]) {
  const rawSegments = [
    { key: 'palace_edit', seconds: item.palace_edit_seconds, color: getTimeRecordChartColor('palace_edit') },
    { key: 'practice', seconds: item.practice_seconds, color: getTimeRecordChartColor('practice') },
    { key: 'quiz', seconds: item.quiz_seconds, color: getTimeRecordChartColor('quiz') },
    { key: 'review', seconds: item.review_seconds, color: getTimeRecordChartColor('review') },
  ].filter((segment) => segment.seconds > 0)

  const total = Math.max(1, item.total_seconds)
  const minimalUnits = rawSegments.length
  const minPercent = rawSegments.length > 1 ? 6 : 100
  const baseWidths = rawSegments.map((segment) => (segment.seconds / total) * 100)
  const promotedFlags = baseWidths.map((width) => width > 0 && width < minPercent)
  const promotedTotal = promotedFlags.reduce((sum, flag) => sum + (flag ? minPercent : 0), 0)
  const untouchedTotal = baseWidths.reduce((sum, width, index) => sum + (promotedFlags[index] ? 0 : width), 0)
  const remainingPercent = Math.max(0, 100 - promotedTotal)

  return rawSegments.map((segment, index) => {
    const width = promotedFlags[index]
      ? minPercent
      : untouchedTotal > 0
        ? (baseWidths[index] / untouchedTotal) * remainingPercent
        : (100 - minimalUnits * minPercent) / Math.max(1, rawSegments.length)
    return {
      ...segment,
      width,
    }
  })
}

type DurationFilterMode = 'month' | 'range' | 'all'

interface DashboardDurationFilterState {
  mode: DurationFilterMode
  month: string
  startDate: string
  endDate: string
  trendRangeDays?: TimeRecordChartRange
  breakdownRangeDays?: TimeRecordChartRange
}

interface NormalizedDashboardDurationFilterState
  extends Omit<
    DashboardDurationFilterState,
    'trendRangeDays' | 'breakdownRangeDays'
  > {
  trendRangeDays: TimeRecordChartRange
  breakdownRangeDays: TimeRecordChartRange
}

const DEFAULT_TIME_RECORD_CHART_RANGE: TimeRecordChartRange = 7
const TIME_RECORD_CHART_RANGE_OPTIONS: Array<{
  label: string
  value: TimeRecordChartRange
}> = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '全部', value: 'all' },
]

function isTimeRecordChartRange(value: unknown): value is TimeRecordChartRange {
  return value === 7 || value === 30 || value === 90 || value === 'all'
}

function getCurrentMonthValue(reference = new Date()) {
  const year = reference.getFullYear()
  const month = `${reference.getMonth() + 1}`.padStart(2, '0')
  return `${year}-${month}`
}

function createDefaultDurationFilterState(reference = new Date()): DashboardDurationFilterState {
  return {
    mode: 'month',
    month: getCurrentMonthValue(reference),
    startDate: '',
    endDate: '',
    trendRangeDays: DEFAULT_TIME_RECORD_CHART_RANGE,
    breakdownRangeDays: DEFAULT_TIME_RECORD_CHART_RANGE,
  }
}

function isDashboardDurationFilterState(value: unknown): value is DashboardDurationFilterState {
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

function normalizeDashboardDurationFilterState(
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

function isDefaultDurationFilterState(filter: DashboardDurationFilterState) {
  return (
    filter.mode === 'month' &&
    filter.month === getCurrentMonthValue() &&
    filter.startDate === '' &&
    filter.endDate === ''
  )
}

function formatSelectedDurationLabel(mode: DurationFilterMode, month: string, startDate: string, endDate: string) {
  if (mode === 'month') return month || '当前月份'
  if (mode === 'all') return '全部'
  if (startDate && endDate) return `${startDate} 至 ${endDate}`
  if (startDate) return `${startDate} 至`
  if (endDate) return `至 ${endDate}`
  return '请选择时间范围'
}

function formatTrendCardTitle(range: TimeRecordChartRange) {
  if (range === 'all') return '全部趋势'
  return `最近 ${range} 天趋势`
}

function hasDurationFilterStateChanged(
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

interface TimeRecordChartCardProps {
  title: string
  selectedRange: TimeRecordChartRange
  onRangeChange: (range: TimeRecordChartRange) => void
  children: React.ReactNode
}

function TimeRecordChartCard({
  title,
  selectedRange,
  onRangeChange,
  children,
}: TimeRecordChartCardProps) {
  return (
    <Card className="min-w-0 border-border/70">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex flex-wrap justify-end gap-2">
          {TIME_RECORD_CHART_RANGE_OPTIONS.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={selectedRange === option.value ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 pt-2">{children}</CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [hoveredLearningPalaceId, setHoveredLearningPalaceId] = useState<number | null>(null)
  const [durationFilter, setDurationFilter] = useLocalStorageState<DashboardDurationFilterState>(
    DASHBOARD_TOTAL_DURATION_FILTER_STORAGE_KEY,
    createDefaultDurationFilterState(),
    isDashboardDurationFilterState,
    'dashboard_duration_filter',
  )
  const normalizedDurationFilter = normalizeDashboardDurationFilterState(
    durationFilter,
  )
  const {
    mode: durationMode,
    month: selectedMonth,
    startDate: rangeStartDate,
    endDate: rangeEndDate,
    trendRangeDays,
    breakdownRangeDays,
  } = normalizedDurationFilter
  const hasInitializedSelectedDurationRef = useRef(false)
  const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false)

  const updateDurationFilter = useCallback(
    (
      updater:
        | Partial<DashboardDurationFilterState>
        | ((
            current: NormalizedDashboardDurationFilterState,
          ) => Partial<DashboardDurationFilterState>),
    ) => {
      setDurationFilter((current) => {
        const normalizedCurrent = normalizeDashboardDurationFilterState(current)
        const patch =
          typeof updater === 'function' ? updater(normalizedCurrent) : updater
        return normalizeDashboardDurationFilterState({
          ...normalizedCurrent,
          ...patch,
        })
      })
    },
    [setDurationFilter],
  )

  const loadDashboard = useCallback(async () => {
    const dashboard = await getDashboardApi()
    setData(dashboard)
    setHasLoadedDashboard(true)
  }, [])

  const loadSelectedDuration = useCallback(async (query: DashboardQuery) => {
    const dashboard = await getDashboardApi(query)
    setData((current) => {
      if (!current) return dashboard
      return {
        ...current,
        selected_total_review_duration_seconds: dashboard.selected_total_review_duration_seconds,
      }
    })
  }, [])
  const timeRecordsDashboard = useTimeRecordsDashboard({
    onRecordsChanged: loadDashboard,
  })

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    if (
      hasDurationFilterStateChanged(durationFilter, normalizedDurationFilter)
    ) {
      setDurationFilter(normalizedDurationFilter)
    }
  }, [durationFilter, normalizedDurationFilter, setDurationFilter])

  useEffect(() => {
    if (!hasLoadedDashboard) return
    if (!hasInitializedSelectedDurationRef.current) {
      hasInitializedSelectedDurationRef.current = true
      if (isDefaultDurationFilterState(normalizedDurationFilter)) {
        return
      }
    }
    if (durationMode === 'month') {
      if (!selectedMonth) return
      void loadSelectedDuration({
        duration_mode: 'month',
        month: selectedMonth,
      })
      return
    }
    if (durationMode === 'all') {
      void loadSelectedDuration({
        duration_mode: 'all',
      })
      return
    }
    if (!rangeStartDate || !rangeEndDate) return
    if (rangeStartDate > rangeEndDate) return
    void loadSelectedDuration({
      duration_mode: 'range',
      start_date: rangeStartDate,
      end_date: rangeEndDate,
    })
  }, [durationMode, hasLoadedDashboard, loadSelectedDuration, normalizedDurationFilter, rangeEndDate, rangeStartDate, selectedMonth])

  if (!data) {
    return <DashboardSkeleton />
  }

  const selectedDurationLabel = formatSelectedDurationLabel(durationMode, selectedMonth, rangeStartDate, rangeEndDate)
  const isRangeInvalid = Boolean(rangeStartDate && rangeEndDate && rangeStartDate > rangeEndDate)
  const dueNowCount = data.due_count ?? 0
  const dueLaterTodayCount = data.due_later_today_count ?? 0
  const needsPracticeCount = data.needs_practice_count ?? 0

  const statCards: Array<{
    label: string
    value?: string | number
    valueNode?: React.ReactNode
    icon: typeof BookOpen
    color: string
    link?: string
    linkText?: string
    subtitle?: string
    extra?: React.ReactNode
  }> = [
    {
      label: '今日待处理',
      icon: BookOpen,
      color: '',
      link: '/review',
      linkText: '开始复习',
      valueNode: (
        <div className="grid grid-cols-3 gap-3" aria-label="今日待处理状态计数">
            <div className="space-y-1">
            <div className="text-3xl font-bold text-destructive">{dueNowCount}</div>
            <div className="text-xs text-muted-foreground">立即复习</div>
          </div>
          <div className="space-y-1">
            <div className="text-3xl font-bold text-warning">{dueLaterTodayCount}</div>
            <div className="text-xs text-muted-foreground">今日稍后</div>
          </div>
          <div className="space-y-1">
            <div className="text-3xl font-bold text-success">{needsPracticeCount}</div>
            <div className="text-xs text-muted-foreground">要练习</div>
          </div>
        </div>
      ),
    },
    {
      label: '今日时长',
      value: formatDuration(data.today_total_review_duration_seconds),
      icon: TrendingUp,
      color: '',
    },
    {
      label: '本周时长',
      value: formatDuration(data.weekly_total_review_duration_seconds),
      icon: Clock3,
      color: '',
    },
    {
      label: '英语',
      value: formatDuration(data.english_stats.today_total_seconds),
      icon: BookOpen,
      color: '',
      subtitle: `英语听力未完成 ${data.english_stats.unfinished_courses} 门 · 累计 ${formatDuration(data.english_stats.total_seconds)}`,
      extra: (
        <div className="mt-3 text-xs text-muted-foreground">
          本周英语时长 {formatDuration(data.english_stats.weekly_total_seconds)}
        </div>
      ),
    },
    {
      label: '总时长',
      value: formatDuration(data.selected_total_review_duration_seconds),
      icon: Timer,
      color: '',
      subtitle: selectedDurationLabel,
      extra: (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={durationMode === 'month' ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => updateDurationFilter({ mode: 'month' })}
            >
              月份
            </Button>
            <Button
              size="sm"
              variant={durationMode === 'range' ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => updateDurationFilter({ mode: 'range' })}
              >
                自定义范围
              </Button>
              <Button
                size="sm"
                variant={durationMode === 'all' ? 'default' : 'outline'}
                className="h-7 px-2"
                onClick={() => updateDurationFilter({ mode: 'all' })}
              >
                显示全部
              </Button>
            </div>
          {durationMode === 'month' ? (
            <Input
              aria-label="选择月份"
              className="h-8 text-xs"
              type="month"
              value={selectedMonth}
              onChange={(event) =>
                updateDurationFilter({ month: event.target.value })
              }
            />
          ) : durationMode === 'range' ? (
            <div className="flex flex-col gap-2">
              <Input
                aria-label="开始日期"
                className="h-8 text-xs"
                type="date"
                value={rangeStartDate}
                onChange={(event) =>
                  updateDurationFilter({ startDate: event.target.value })
                }
              />
              <Input
                aria-label="结束日期"
                className="h-8 text-xs"
                type="date"
                value={rangeEndDate}
                onChange={(event) =>
                  updateDurationFilter({ endDate: event.target.value })
                }
              />
              {isRangeInvalid ? (
                <p className="text-[11px] text-destructive">开始日期不能晚于结束日期。</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {statCards.map(({ label, value, valueNode, icon: Icon, color, link, linkText, subtitle, extra }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {valueNode ?? <div className={`text-3xl font-bold ${color}`}>{value}</div>}
              {link && dueNowCount > 0 ? (
                <Link to={link} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                  {linkText}
                  <ArrowRight className="size-3" />
                </Link>
              ) : subtitle ? (
                <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
              {extra}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex flex-col gap-2">
              <CardTitle className="text-base">今日学习</CardTitle>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {dashboardLearningLegend.map((legend) => (
                  <span key={legend.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: legend.color }}
                    />
                    <span>{legend.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {data.today_learning_palaces.length > 0 ? (
              <div className="flex flex-col gap-3">
                {data.today_learning_palaces.map((item) => {
                  const segments = buildLearningSegments(item)
                  const isTooltipVisible = hoveredLearningPalaceId === item.palace_id
                  return (
                    <div key={item.palace_id} className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium">{item.palace_title || '未命名宫殿'}</div>
                        <div className="shrink-0 text-xs text-muted-foreground">{formatDuration(item.total_seconds)}</div>
                      </div>
                      <div className="relative mt-2">
                        <div
                          className="flex h-3 overflow-hidden rounded-full border border-border/60 bg-secondary/80 shadow-inner"
                          onMouseEnter={() => setHoveredLearningPalaceId(item.palace_id)}
                          onMouseLeave={() => setHoveredLearningPalaceId((current) => (current === item.palace_id ? null : current))}
                          onFocus={() => setHoveredLearningPalaceId(item.palace_id)}
                          onBlur={() => setHoveredLearningPalaceId((current) => (current === item.palace_id ? null : current))}
                          tabIndex={0}
                          role="img"
                          aria-label={`${item.palace_title || '未命名宫殿'} 学习时长结构`}
                        >
                          {segments.map((segment) => (
                            <div
                              key={segment.key}
                              className="h-full"
                              style={{
                                width: `${segment.width}%`,
                                backgroundColor: segment.color,
                              }}
                            />
                          ))}
                        </div>
                        {isTooltipVisible ? (
                          <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover">
                            {formatLearningTooltip(item).split('\n').map((line, index) => (
                              <div
                                key={`${item.palace_id}-${index}`}
                                className={cn(
                                  'whitespace-nowrap',
                                  index === 0 ? 'mb-1 font-medium text-foreground' : 'text-muted-foreground',
                                )}
                              >
                                {line}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">今天还没有产生学习时长记录。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{`新增章节数量：${data.today_new_palace_count}`}</CardTitle>
            <Link to="/palaces/new">
              <Button size="sm" variant="outline" className="h-8">
                <Plus data-icon="inline-start" />
                新建
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.today_new_palaces.some((subject) => subject.chapter_groups.length > 0 || subject.ungrouped_palaces.length > 0) ? (
              <div className="flex flex-col gap-4">
                {data.today_new_palaces.map((subjectGroup, subjectIndex) => {
                  const hasAny = subjectGroup.chapter_groups.length > 0 || subjectGroup.ungrouped_palaces.length > 0
                  if (!hasAny) return null
                  const showSubjectTitle = data.today_new_palaces.filter((item) => item.subject).length > 1
                  return (
                    <div key={`${subjectGroup.subject?.id ?? 'ungrouped'}-${subjectIndex}`} className="flex flex-col gap-2">
                      {showSubjectTitle && subjectGroup.subject ? (
                        <div className="text-xs font-medium text-muted-foreground">{subjectGroup.subject.name}</div>
                      ) : null}
                      {subjectGroup.chapter_groups.map((group) => (
                        <div key={group.source_chapter?.id ?? `group-${subjectIndex}`} className="flex flex-col gap-1">
                          <div className="text-sm font-semibold">{group.source_chapter?.name ?? '未关联章节'}</div>
                          <div className="flex flex-col gap-1.5 pl-4">
                            {group.palaces.map((palace) => (
                              <Link
                                key={palace.id}
                                to={`/palaces/${palace.id}/edit`}
                                className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                              >
                                {palace.title || '未命名宫殿'}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                      {subjectGroup.ungrouped_palaces.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <div className="text-sm font-semibold text-muted-foreground">未关联章节</div>
                          <div className="flex flex-col gap-1.5 pl-4">
                            {subjectGroup.ungrouped_palaces.map((palace) => (
                              <Link
                                key={palace.id}
                                to={`/palaces/${palace.id}/edit`}
                                className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                              >
                                  {palace.title || '未命名宫殿'}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                今天还没有新增记忆宫殿。
                <div className="mt-3">
                  <Link to="/palaces/new">
                    <Button variant="outline" size="sm">
                      <Sparkles data-icon="inline-start" />
                      创建一个
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TimeRecordChartCard
            title={formatTrendCardTitle(trendRangeDays)}
            selectedRange={trendRangeDays}
            onRangeChange={(range) =>
              updateDurationFilter({ trendRangeDays: range })
            }
          >
            <TimeRecordsTrendChart
              trend={timeRecordsDashboard.getTrendForRange(trendRangeDays)}
            />
          </TimeRecordChartCard>
          <TimeRecordChartCard
            title="会话类型分布"
            selectedRange={breakdownRangeDays}
            onRangeChange={(range) =>
              updateDurationFilter({ breakdownRangeDays: range })
            }
          >
            <TimeRecordsBreakdownChart
              breakdown={timeRecordsDashboard.getBreakdownForRange(
                breakdownRangeDays,
              )}
            />
          </TimeRecordChartCard>
        </div>

        <TimeRecordsTable
          thresholdInput={timeRecordsDashboard.thresholdInput}
          onThresholdInputChange={timeRecordsDashboard.setThresholdInput}
          onThresholdBlur={() => void timeRecordsDashboard.applyThreshold()}
          showBelowThreshold={timeRecordsDashboard.showBelowThreshold}
          onShowBelowThresholdChange={timeRecordsDashboard.setShowBelowThreshold}
          keyword={timeRecordsDashboard.keyword}
          onKeywordChange={timeRecordsDashboard.setKeyword}
          kindFilter={timeRecordsDashboard.kindFilter}
          onKindFilterChange={timeRecordsDashboard.setKindFilter}
          showDeleted={timeRecordsDashboard.showDeleted}
          onShowDeletedChange={timeRecordsDashboard.setShowDeleted}
          onCreateRecord={timeRecordsDashboard.openCreateDialog}
          onBulkDelete={() => void timeRecordsDashboard.handleBulkDelete()}
          bulkDeleteDisabled={!timeRecordsDashboard.hasSelectedRecords}
          isBulkDeleting={timeRecordsDashboard.isBulkDeleting}
          deletingRecordId={timeRecordsDashboard.deletingRecordId}
          visibleRecords={timeRecordsDashboard.visibleRecords}
          pendingRecoveryRecords={timeRecordsDashboard.pendingRecoveryRecords}
          hasSelectableRecords={timeRecordsDashboard.hasSelectableRecords}
          allSelectableChecked={timeRecordsDashboard.allSelectableChecked}
          selectedRecordIds={timeRecordsDashboard.selectedRecordIds}
          onToggleSelectAllVisible={
            timeRecordsDashboard.toggleSelectAllVisible
          }
          onToggleRecordSelection={timeRecordsDashboard.toggleRecordSelection}
          onEditRecord={timeRecordsDashboard.openEditDialog}
          onDeleteRecord={timeRecordsDashboard.handleDeleteRecord}
          onReplayPendingRecovery={
            timeRecordsDashboard.handleReplayPendingRecovery
          }
          onDismissPendingRecovery={
            timeRecordsDashboard.handleDismissPendingRecovery
          }
        />
      </div>

      <TimeRecordDialog
        open={timeRecordsDashboard.dialogOpen}
        mode={timeRecordsDashboard.dialogMode}
        form={timeRecordsDashboard.formState}
        error={timeRecordsDashboard.formError}
        isSubmitting={timeRecordsDashboard.isSubmittingRecord}
        onOpenChange={timeRecordsDashboard.onDialogOpenChange}
        onChange={timeRecordsDashboard.onFormChange}
        onSubmit={(event) => void timeRecordsDashboard.handleSubmitRecord(event)}
      />
    </div>
  )
}
