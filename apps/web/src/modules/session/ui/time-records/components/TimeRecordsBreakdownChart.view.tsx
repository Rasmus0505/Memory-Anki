import { useMemo } from 'react'
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
import type { SessionKindBreakdownItem } from '@/modules/session/domain/session-entity/model/session-records'
import { formatDuration } from '@/modules/session/domain/session-entity/model/session-records-store'
import {
  getTimeRecordChartColor,
  timeRecordChartConfig,
} from '@/modules/session/domain/session-entity/model/time-record-visuals'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

interface TimeRecordsBreakdownChartViewProps {
  breakdown: SessionKindBreakdownItem[]
}

const formatAxisDuration = (value: number | string) =>
  formatDuration(Number(value ?? 0))

const breakdownTooltipContent = (
  <ChartTooltipContent formatter={(value) => formatDuration(value)} />
)

export default function TimeRecordsBreakdownChartView({
  breakdown,
}: TimeRecordsBreakdownChartViewProps) {
  const chartData = useMemo(
    () =>
      breakdown.map((entry) => ({
        ...entry,
        fill: getTimeRecordChartColor(entry.kind),
      })),
    [breakdown],
  )

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
        <BarChart
          data={chartData}
          margin={{ left: 8, right: 16, top: 16, bottom: 8 }}
        >
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
            interval={0}
            minTickGap={16}
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
            cursor={{ fill: 'rgba(148,163,184,0.08)' }}
            content={breakdownTooltipContent}
          />
          <Bar
            dataKey="seconds"
            name="有效时长"
            radius={[12, 12, 6, 6]}
            isAnimationActive={false}
            maxBarSize={64}
          >
            {chartData.map((entry) => (
              <Cell key={entry.kind} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}
