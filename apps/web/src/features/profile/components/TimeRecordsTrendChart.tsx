import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDuration, type DailyTrendPoint } from '@/entities/session/model'
import { timeRecordChartConfig } from '@/entities/session/model'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

interface TimeRecordsTrendChartProps {
  trend: DailyTrendPoint[]
}

export function TimeRecordsTrendChart({
  trend,
}: TimeRecordsTrendChartProps) {
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
          initialDimension={{ width: 1, height: 1 }}
        >
          <AreaChart
            data={trend}
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
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              width={60}
              tickFormatter={(value) => formatDuration(Number(value ?? 0))}
            />
            <Tooltip
              cursor={{
                stroke: 'rgba(37,99,235,0.18)',
                strokeWidth: 1,
              }}
              content={
                <ChartTooltipContent
                  formatter={(value) => formatDuration(value)}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="seconds"
              name="有效时长"
              stroke="var(--color-seconds)"
              strokeWidth={2.5}
              fill="url(#trendFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  )
}
