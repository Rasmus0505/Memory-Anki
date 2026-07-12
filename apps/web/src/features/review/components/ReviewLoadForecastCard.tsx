import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getReviewLoadForecastApi } from '@/features/review/api'
import type { ReviewLoadForecastResponse } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

type ForecastDays = 7 | 30

interface ReviewLoadForecastChartItem {
  date: string
  due_count: number
  is_today: boolean
  overdue: boolean
}

const forecastChartConfig = {
  due_count: {
    label: '到期复习',
    color: '#6366f1',
  },
}

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
        <ChartContainer
          config={forecastChartConfig}
          className="h-48 min-h-48 min-w-0"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            initialDimension={{ width: 1, height: 1 }}
          >
            <BarChart
              data={chartData}
              margin={{ left: 4, right: 12, top: 12, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148,163,184,0.18)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={11}
                tick={{ fill: 'var(--color-muted-foreground)' }}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={28}
                fontSize={11}
                tick={{ fill: 'var(--color-muted-foreground)' }}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                content={
                  <ChartTooltipContent
                    formatter={(value) => `${value} 项`}
                  />
                }
              />
              <Bar
                dataKey="due_count"
                name="到期复习"
                radius={[4, 4, 0, 0]}
              >
                {chartData.map((entry) => (
                  <Cell
                    key={`${entry.date}-${entry.overdue ? 'overdue' : 'due'}`}
                    fill={entry.overdue ? '#ef4444' : entry.is_today ? '#f59e0b' : '#6366f1'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
