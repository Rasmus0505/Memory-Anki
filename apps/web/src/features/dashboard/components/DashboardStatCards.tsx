import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, BookOpen, Clock3, Timer, TrendingUp } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import {
  buildTodayTodoBuckets,
  getBucketWidth,
  todayTodoToneClassName,
} from '@/features/dashboard/model/dashboard-derive'
import {
  formatSelectedDurationLabel,
  type DashboardDurationFilterState,
  type NormalizedDashboardDurationFilterState,
} from '@/features/dashboard/model/dashboard-duration-filter'

interface DashboardStatCardsProps {
  data: DashboardResponse
  durationFilter: NormalizedDashboardDurationFilterState
  onUpdateDurationFilter: (
    patch:
      | Partial<DashboardDurationFilterState>
      | ((
          current: NormalizedDashboardDurationFilterState,
        ) => Partial<DashboardDurationFilterState>),
  ) => void
}

export function getTodayTodoTotal(data: DashboardResponse) {
  return buildTodayTodoBuckets(data).reduce((sum, bucket) => sum + bucket.count, 0)
}

export function DashboardStatCards({
  data,
  durationFilter,
  onUpdateDurationFilter,
}: DashboardStatCardsProps) {
  const {
    mode: durationMode,
    month: selectedMonth,
    startDate: rangeStartDate,
    endDate: rangeEndDate,
  } = durationFilter
  const selectedDurationLabel = formatSelectedDurationLabel(durationMode, selectedMonth, rangeStartDate, rangeEndDate)
  const isRangeInvalid = Boolean(rangeStartDate && rangeEndDate && rangeStartDate > rangeEndDate)
  const todayTodoBuckets = buildTodayTodoBuckets(data)
  const todayTodoTotal = todayTodoBuckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const activeTodayTodoBuckets = todayTodoBuckets.filter((bucket) => bucket.count > 0).length
  const dueNowCount = data.due_count ?? 0

  const statCards: Array<{
    label: string
    value?: string | number
    valueNode?: React.ReactNode
    icon: LucideIcon
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
        <div className="space-y-3" aria-label="今日待处理优先级">
          <div className="flex min-h-3 overflow-hidden rounded-full border border-border/60 bg-secondary/80">
            {todayTodoBuckets.map((bucket) => {
              const tone = todayTodoToneClassName[bucket.tone]
              const width = getBucketWidth(bucket.count, todayTodoTotal, activeTodayTodoBuckets)
              return bucket.count > 0 ? (
                <div
                  key={bucket.key}
                  className={cn('h-3', tone.bar)}
                  style={{ width: `${width}%` }}
                  title={`${bucket.label}：${bucket.count}`}
                />
              ) : null
            })}
            {todayTodoTotal === 0 ? <div className="h-3 w-full bg-muted" /> : null}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:grid-cols-1 2xl:grid-cols-3">
            {todayTodoBuckets.map((bucket) => {
              const tone = todayTodoToneClassName[bucket.tone]
              return (
                <div
                  key={bucket.key}
                  className={cn('min-w-0 rounded-lg border px-2.5 py-2', tone.border, tone.bg)}
                >
                  <div className={cn('text-2xl font-bold leading-none', tone.text)}>{bucket.count}</div>
                  <div className="mt-1 truncate text-xs font-medium text-foreground">{bucket.label}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{bucket.helper}</div>
                </div>
              )
            })}
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
              onClick={() => onUpdateDurationFilter({ mode: 'month' })}
            >
              月份
            </Button>
            <Button
              size="sm"
              variant={durationMode === 'range' ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => onUpdateDurationFilter({ mode: 'range' })}
            >
              自定义范围
            </Button>
            <Button
              size="sm"
              variant={durationMode === 'all' ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => onUpdateDurationFilter({ mode: 'all' })}
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
                onUpdateDurationFilter({ month: event.target.value })
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
                  onUpdateDurationFilter({ startDate: event.target.value })
                }
              />
              <Input
                aria-label="结束日期"
                className="h-8 text-xs"
                type="date"
                value={rangeEndDate}
                onChange={(event) =>
                  onUpdateDurationFilter({ endDate: event.target.value })
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
  )
}
