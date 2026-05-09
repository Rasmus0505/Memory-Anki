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
      <CardContent className="space-y-4">
        <div className="h-[320px] rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.7))] p-4">
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
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {breakdown.map((entry) => (
            <div
              key={entry.kind}
              className="rounded-2xl border border-border/70 bg-background/80 px-4 py-4"
            >
              <div className="text-sm font-medium text-slate-900">
                {entry.label}
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-950">
                {formatDuration(entry.seconds)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {entry.sessions} 条记录
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
