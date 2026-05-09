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
} from '@/entities/session/model'
import {
  getTimeRecordChartColor,
  timeRecordChartConfig,
} from '@/features/profile/model/time-record-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

interface TimeRecordsBreakdownChartProps {
  breakdown: SessionKindBreakdownItem[]
}

export function TimeRecordsBreakdownChart({
  breakdown,
}: TimeRecordsBreakdownChartProps) {
  return (
    <Card className="rounded-[28px] border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">会话类型分布</CardTitle>
      </CardHeader>
      <CardContent className="h-[360px]">
        <ChartContainer config={timeRecordChartConfig} className="h-full">
          <ResponsiveContainer width="100%" height="100%">
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
      </CardContent>
    </Card>
  )
}
