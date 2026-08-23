import { Suspense, memo } from 'react'
import type { SessionKindBreakdownItem } from '@/modules/session/domain/session-entity/model/session-records'
import { WidgetErrorBoundary } from '@/shared/components/widget-error-boundary'
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
      {/* 没有边界时，图表 chunk 加载失败只会留下一个永远脉动的灰块。 */}
      <WidgetErrorBoundary label="分布图表" className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
        <Suspense fallback={<ChartSkeleton />}>
          <TimeRecordsBreakdownChartView breakdown={breakdown} />
        </Suspense>
      </WidgetErrorBoundary>
    </div>
  )
}

export const TimeRecordsBreakdownChart = memo(TimeRecordsBreakdownChartComponent)
