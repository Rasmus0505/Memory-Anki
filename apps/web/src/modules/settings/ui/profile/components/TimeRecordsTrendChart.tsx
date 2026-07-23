import { memo, useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDuration, type DailyTrendPoint } from '@/modules/session/public'
import { timeRecordChartConfig } from '@/modules/session/public'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

interface TimeRecordsTrendChartProps {
  trend: DailyTrendPoint[]
}

const formatAxisDuration = (value: number | string) =>
  formatDuration(Number(value ?? 0))

const trendTooltipContent = (
  <ChartTooltipContent formatter={(value) => formatDuration(value)} />
)

function TimeRecordsTrendChartComponent({
  trend,
}: TimeRecordsTrendChartProps) {
  // Cap dense ranges so recharts does not recompute hundreds of monotone points.
  const chartData = useMemo(() => {
    if (trend.length <= 120) return trend
    const step = Math.ceil(trend.length / 90)
    return trend.filter((_, index) => index % step === 0 || index === trend.length - 1)
  }, [trend])

  const xInterval = chartData.length > 14 ? Math.ceil(chartData.length / 8) - 1 : 0

  return (
    <div className="h-[360px] min-h-[360px] min-w-0">
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
    </div>
  )
}

export const TimeRecordsTrendChart = memo(TimeRecordsTrendChartComponent)
