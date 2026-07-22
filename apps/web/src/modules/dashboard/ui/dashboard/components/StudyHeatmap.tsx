import { useEffect, useMemo, useState } from 'react'
import type {
  DashboardHeatmapResponse,
  HeatmapDayItem,
} from '@/shared/api/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { getDashboardHeatmapApi } from '../api'

type HeatmapCell = HeatmapDayItem | null

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

  const cells = useMemo<HeatmapCell[]>(() => {
    if (!data) return []
    return [
      ...Array<null>(getLeadingEmptyCells(data.items)).fill(null),
      ...data.items,
    ]
  }, [data])

  if (!data) return null

  return (
    <Card className="min-w-0 border-border/70">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <CardTitle className="text-lg">学习热力图</CardTitle>
        <div className="text-right text-sm leading-6 text-muted-foreground">
          连续 {data.current_streak} 天 · 最长 {data.longest_streak} 天 · 近半年学习{' '}
          {data.active_day_count} 天
        </div>
      </CardHeader>
      <CardContent className="min-w-0 overflow-x-auto pt-1">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
          {cells.map((item, index) =>
            item ? (
              <div
                key={item.date}
                title={`${item.date}：复习 ${item.review_count} 次，学习 ${formatMinutes(item.study_seconds)} 分钟`}
                className={`size-3 rounded-sm ${intensityClass(item)}`}
              />
            ) : (
              <div key={`empty-${index}`} className="size-3" />
            ),
          )}
        </div>
      </CardContent>
    </Card>
  )
}
