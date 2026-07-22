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
import {
  formatDuration,
  type SessionKindBreakdownItem,
} from '@/modules/session/public'
import {
  getTimeRecordChartColor,
  timeRecordChartConfig,
} from '@/modules/session/public'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

interface TimeRecordsBreakdownChartProps {
  breakdown: SessionKindBreakdownItem[]
}

export function TimeRecordsBreakdownChart({
  breakdown,
}: TimeRecordsBreakdownChartProps) {
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
          <BarChart
            data={breakdown}
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
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              width={60}
              tickFormatter={(value) => formatDuration(Number(value ?? 0))}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              content={
                <ChartTooltipContent
                  formatter={(value) => formatDuration(value)}
                />
              }
            />
            <Bar
              dataKey="seconds"
              name="有效时长"
              radius={[12, 12, 6, 6]}
            >
              {breakdown.map((entry) => (
                <Cell
                  key={entry.kind}
                  fill={getTimeRecordChartColor(entry.kind)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  )
}
