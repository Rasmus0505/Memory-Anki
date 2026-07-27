import { Suspense, useEffect, useMemo, useState } from 'react'
import { getReviewLoadForecastApi } from '@/modules/practice/ui/review/api'
import type { ReviewLoadForecastResponse } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import type { ReviewLoadForecastChartItem } from './ReviewLoadForecastChart.view'

// recharts 只在卡片实际出现时加载，避免经 practice/public 桶进入首屏静态依赖图。
const ReviewLoadForecastChartView = lazyWithRetry(
  () => import('./ReviewLoadForecastChart.view'),
)

type ForecastDays = 7 | 30

export function ReviewLoadForecastCard() {
  const [days, setDays] = useState<ForecastDays>(7)
  const [data, setData] = useState<ReviewLoadForecastResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    getReviewLoadForecastApi(days)
      .then((payload) => {
        if (!cancelled) {
          setData(payload)
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [days])

  const chartData = useMemo<ReviewLoadForecastChartItem[]>(() => {
    if (!data) return []

    return [
      ...(data.overdue_count > 0
        ? [
            {
              date: '逾期',
              due_count: data.overdue_count,
              is_today: false,
              overdue: true,
            },
          ]
        : []),
      ...data.items.map((item) => ({
        ...item,
        overdue: false,
        date: item.is_today ? '今天' : item.date.slice(5),
      })),
    ]
  }, [data])

  if (!data) return null

  return (
    <Card className="min-w-0 border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <CardTitle className="text-base font-semibold leading-6 tracking-tight">
          未来负载 · {days} 天共 {data.total_upcoming} 项
          {data.overdue_count > 0 ? `（另有 ${data.overdue_count} 项逾期）` : ''}
        </CardTitle>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant={days === 7 ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => setDays(7)}
          >
            7 天
          </Button>
          <Button
            type="button"
            size="sm"
            variant={days === 30 ? 'default' : 'outline'}
            className="h-7 px-2"
            onClick={() => setDays(30)}
          >
            30 天
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 pt-2">
        <Suspense fallback={<div className="h-48 min-h-48 w-full animate-pulse rounded-xl bg-muted/50" />}>
          <ReviewLoadForecastChartView chartData={chartData} />
        </Suspense>
      </CardContent>
    </Card>
  )
}
