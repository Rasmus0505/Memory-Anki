import { Timer } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import {
  formatDuration,
  formatTimeRecordRangeLabel,
  type TimeRecordFilterState,
  type TimeRecordSourceSummary,
} from '@/modules/session/public'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

interface DashboardStatCardsProps {
  data: DashboardResponse
  timeRecordFilter: TimeRecordFilterState
  timeRecordSummary: TimeRecordSourceSummary
  className?: string
}

export function DashboardStatCards({
  data,
  timeRecordFilter,
  timeRecordSummary,
  className,
}: DashboardStatCardsProps) {
  const english = data.english_stats
  const stats: Array<{ label: string; value: string; hint?: string }> = [
    { label: '今日时长', value: formatDuration(data.today_total_review_duration_seconds) },
    { label: '本周时长', value: formatDuration(data.weekly_total_review_duration_seconds) },
    {
      label: '英语',
      value: formatDuration(english?.today_total_seconds ?? 0),
      hint: `本周 ${formatDuration(english?.weekly_total_seconds ?? 0)} · 未完成 ${english?.unfinished_courses ?? 0} 门`,
    },
    {
      label: '总时长',
      value: formatDuration(timeRecordSummary.totalEffectiveSeconds),
      hint: formatTimeRecordRangeLabel(timeRecordFilter),
    },
  ]

  return (
    <Card className={cn('shrink-0', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-base">学习时长</CardTitle>
        <Timer className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-1.5 p-4 pt-1">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 rounded-xl bg-muted/50 px-2.5 py-1.5">
            <div className="truncate text-[11px] text-muted-foreground">{stat.label}</div>
            <div className="truncate text-lg font-semibold tabular-nums">{stat.value}</div>
            {stat.hint ? <div className="truncate text-[11px] text-muted-foreground">{stat.hint}</div> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
