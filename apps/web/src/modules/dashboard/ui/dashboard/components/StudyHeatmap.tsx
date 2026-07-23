import { useEffect, useMemo, useState } from 'react'
import type {
  DashboardHeatmapResponse,
  HeatmapDayItem,
  WeeklyReport,
} from '@/shared/api/contracts'
import { formatDuration } from '@/modules/session/public'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { getDashboardHeatmapApi, getWeeklyReportApi } from '../api'

type HeatmapCell = HeatmapDayItem | null

const EMPTY_WEEKLY_REPORT: WeeklyReport = {
  week_start: '',
  week_end: '',
  study_seconds: 0,
  review_count: 0,
  average_score: 0,
  new_palace_count: 0,
}

function getLeadingEmptyCells(items: HeatmapDayItem[]) {
  if (items.length === 0) return 0
  const start = new Date(`${items[0].date}T00:00:00`)
  return (start.getDay() + 6) % 7
}

function intensityClass(item: HeatmapDayItem) {
  if (!item.active) return 'bg-muted'
  const minutes = item.study_seconds / 60 + item.review_count * 5
  if (minutes >= 90) return 'bg-emerald-600'
  if (minutes >= 45) return 'bg-emerald-500'
  if (minutes >= 15) return 'bg-emerald-400'
  return 'bg-emerald-200'
}

function formatMinutes(seconds: number) {
  return Math.round(seconds / 60)
}

export function StudyHeatmap() {
  const [data, setData] = useState<DashboardHeatmapResponse | null>(null)
  const [report, setReport] = useState<WeeklyReport>(EMPTY_WEEKLY_REPORT)
  const [reportLoading, setReportLoading] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDashboardHeatmapApi()
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let active = true
    setReportLoading(true)
    setReportError(null)
    void getWeeklyReportApi(1)
      .then((payload) => {
        if (active) setReport(payload)
      })
      .catch((requestError) => {
        if (active) {
          setReportError(
            requestError instanceof Error
              ? requestError.message
              : '上周摘要加载失败。',
          )
        }
      })
      .finally(() => {
        if (active) setReportLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const cells = useMemo<HeatmapCell[]>(() => {
    if (!data) return []
    return [
      ...Array<null>(getLeadingEmptyCells(data.items)).fill(null),
      ...data.items,
    ]
  }, [data])

  const hasActivity =
    report.study_seconds > 0 ||
    report.review_count > 0 ||
    report.average_score > 0 ||
    report.new_palace_count > 0
  const titleRange =
    report.week_start && report.week_end
      ? `（${report.week_start} ~ ${report.week_end}）`
      : ''
  const metrics = [
    { label: '学习时长', value: formatDuration(report.study_seconds) },
    { label: '复习次数', value: `${report.review_count} 次` },
    { label: '平均分', value: report.average_score.toFixed(1) },
    { label: '新建宫殿', value: `${report.new_palace_count} 个` },
  ]

  return (
    <Card className="min-w-0 border-border/70">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <CardTitle className="text-base">学习热力图</CardTitle>
        <div className="text-right text-xs leading-5 text-muted-foreground">
          {data
            ? `连续 ${data.current_streak} 天 · 最长 ${data.longest_streak} 天 · 近半年学习 ${data.active_day_count} 天`
            : '加载中...'}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-5 pt-1">
        {data ? (
          <div className="overflow-x-auto">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
              {cells.map((item, index) =>
                item ? (
                  <div
                    key={item.date}
                    title={`${item.date}：复习 ${item.review_count} 次，学习 ${formatMinutes(item.study_seconds)} 分钟`}
                    className={`size-2.5 rounded-sm ${intensityClass(item)}`}
                  />
                ) : (
                  <div key={`empty-${index}`} className="size-2.5" />
                ),
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">正在加载热力图...</p>
        )}

        <div className="space-y-3 border-t border-border/60 pt-4">
          <div>
            <h3 className="text-sm font-medium">上周摘要{titleRange}</h3>
            {reportLoading ? (
              <p className="mt-1 text-xs text-muted-foreground">
                正在生成上周摘要...
              </p>
            ) : null}
          </div>
          {!reportLoading && hasActivity ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-lg border bg-secondary/35 px-3 py-2"
                >
                  <div className="text-xs text-muted-foreground">
                    {metric.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold">{metric.value}</div>
                </div>
              ))}
            </div>
          ) : null}
          {!reportLoading && !hasActivity ? (
            <p className="text-sm text-muted-foreground">上周没有学习记录</p>
          ) : null}
          {reportError ? (
            <p className="text-xs text-destructive">{reportError}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
