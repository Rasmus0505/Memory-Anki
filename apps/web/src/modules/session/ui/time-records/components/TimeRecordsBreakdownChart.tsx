import { Suspense, memo } from 'react'
import type { SessionKindBreakdownItem } from '@/modules/session/domain/session-entity/model/session-records'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'

// recharts 只在图表真正渲染时加载，避免经 settings/public 桶进入首屏静态依赖图。
const TimeRecordsBreakdownChartView = lazyWithRetry(
  () => import('./TimeRecordsBreakdownChart.view'),
)

interface TimeRecordsBreakdownChartProps {
  breakdown: SessionKindBreakdownItem[]
}

function ChartSkeleton() {
  return <div className="h-full w-full animate-pulse rounded-xl bg-muted/50" />
}

function TimeRecordsBreakdownChartComponent({
  breakdown,
}: TimeRecordsBreakdownChartProps) {
  return (
    <div className="h-[360px] min-h-[360px] min-w-0">
      <Suspense fallback={<ChartSkeleton />}>
        <TimeRecordsBreakdownChartView breakdown={breakdown} />
      </Suspense>
    </div>
  )
}

export const TimeRecordsBreakdownChart = memo(TimeRecordsBreakdownChartComponent)
