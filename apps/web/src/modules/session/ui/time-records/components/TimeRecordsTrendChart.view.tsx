import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyTrendPoint } from '@/modules/session/domain/session-entity/model/session-records'
import { formatDuration } from '@/modules/session/domain/session-entity/model/session-records-store'
import { timeRecordChartConfig } from '@/modules/session/domain/session-entity/model/time-record-visuals'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

interface TimeRecordsTrendChartViewProps {
  trend: DailyTrendPoint[]
}

const formatAxisDuration = (value: number | string) =>
  formatDuration(Number(value ?? 0))

const trendTooltipContent = (
  <ChartTooltipContent formatter={(value) => formatDuration(value)} />
)

const MAX_TREND_POINTS = 120
const TARGET_TREND_BUCKETS = 90

/**
 * Cap dense ranges so recharts does not recompute hundreds of monotone points.
 *
 * Buckets sum rather than sample. Dropping every Nth point used to plot one
 * day's total as if it covered the whole span, so the area under the curve
 * stopped matching real study time on long histories.
 */
export function bucketTrendPoints(trend: DailyTrendPoint[]): DailyTrendPoint[] {
  if (trend.length <= MAX_TREND_POINTS) return trend
  const bucketSize = Math.ceil(trend.length / TARGET_TREND_BUCKETS)
  const buckets: DailyTrendPoint[] = []
  for (let index = 0; index < trend.length; index += bucketSize) {
    const slice = trend.slice(index, index + bucketSize)
    const first = slice[0]
    const last = slice[slice.length - 1]
    buckets.push({
      dateKey: first.dateKey,
      label: slice.length > 1 ? `${first.label}-${last.label}` : first.label,
      seconds: slice.reduce((total, point) => total + point.seconds, 0),
    })
  }
  return buckets
}

export default function TimeRecordsTrendChartView({
  trend,
}: TimeRecordsTrendChartViewProps) {
  const chartData = useMemo(() => bucketTrendPoints(trend), [trend])

  const xInterval = chartData.length > 14 ? Math.ceil(chartData.length / 8) - 1 : 0

  return (
    <ChartContainer
      config={timeRecordChartConfig}
      className="h-full min-h-0 min-w-0"
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={{ width: 480, height: 320 }}
        debounce={80}
      >
        <AreaChart
          data={chartData}
          margin={{ left: 8, right: 16, top: 16, bottom: 8 }}
        >
          <defs>
            <linearGradient
              id="trendFill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor="var(--color-seconds)"
                stopOpacity={0.28}
              />
              <stop
                offset="95%"
                stopColor="var(--color-seconds)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="rgba(148,163,184,0.18)"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            interval={xInterval}
            minTickGap={28}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={12}
            width={60}
            tickFormatter={formatAxisDuration}
            allowDecimals={false}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{
              stroke: 'rgba(37,99,235,0.18)',
              strokeWidth: 1,
            }}
            content={trendTooltipContent}
          />
          <Area
            type="linear"
            dataKey="seconds"
            name="有效时长"
            stroke="var(--color-seconds)"
            strokeWidth={2}
            fill="url(#trendFill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}
