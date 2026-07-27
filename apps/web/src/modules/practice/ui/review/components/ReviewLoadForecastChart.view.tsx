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
import { ChartContainer, ChartTooltipContent } from '@/shared/components/ui/chart'

export interface ReviewLoadForecastChartItem {
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

export default function ReviewLoadForecastChartView({
  chartData,
}: {
  chartData: ReviewLoadForecastChartItem[]
}) {
  return (
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
  )
}
