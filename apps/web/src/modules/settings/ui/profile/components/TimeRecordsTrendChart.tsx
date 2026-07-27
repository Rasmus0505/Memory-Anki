import { Suspense, memo } from 'react'
import type { DailyTrendPoint } from '@/modules/session/public'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'

// recharts 只在图表真正渲染时加载，避免经 settings/public 桶进入首屏静态依赖图。
const TimeRecordsTrendChartView = lazyWithRetry(
  () => import('./TimeRecordsTrendChart.view'),
)

interface TimeRecordsTrendChartProps {
  trend: DailyTrendPoint[]
}

function ChartSkeleton() {
  return <div className="h-full w-full animate-pulse rounded-xl bg-muted/50" />
}

function TimeRecordsTrendChartComponent({ trend }: TimeRecordsTrendChartProps) {
  return (
    <div className="h-[360px] min-h-[360px] min-w-0">
      <Suspense fallback={<ChartSkeleton />}>
        <TimeRecordsTrendChartView trend={trend} />
      </Suspense>
    </div>
  )
}

export const TimeRecordsTrendChart = memo(TimeRecordsTrendChartComponent)
