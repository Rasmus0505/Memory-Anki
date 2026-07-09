import { useEffect, useState } from 'react'
import { getWeeklyReportApi } from '@/features/dashboard/api'
import type { WeeklyReport } from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const EMPTY_WEEKLY_REPORT: WeeklyReport = {
  week_start: '',
  week_end: '',
  study_seconds: 0,
  review_count: 0,
  average_score: 0,
  new_palace_count: 0,
}

export function WeeklyReportCard() {
  const [report, setReport] = useState<WeeklyReport>(EMPTY_WEEKLY_REPORT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void getWeeklyReportApi(1)
      .then((payload) => {
        if (active) setReport(payload)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : '上周摘要加载失败。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const hasActivity = report.study_seconds > 0 || report.review_count > 0 || report.average_score > 0 || report.new_palace_count > 0
  const titleRange = report.week_start && report.week_end ? `（${report.week_start} ~ ${report.week_end}）` : ''
  const metrics = [
    { label: '学习时长', value: formatDuration(report.study_seconds) },
    { label: '复习次数', value: `${report.review_count} 次` },
    { label: '平均分', value: report.average_score.toFixed(1) },
    { label: '新建宫殿', value: `${report.new_palace_count} 个` },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">上周摘要{titleRange}</CardTitle>
        {loading ? <p className="text-xs text-muted-foreground">正在生成上周摘要...</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {hasActivity ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border bg-secondary/35 px-3 py-2">
                <div className="text-xs text-muted-foreground">{metric.label}</div>
                <div className="mt-1 text-lg font-semibold">{metric.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">上周没有学习记录</p>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
