import { Suspense, memo } from 'react'
import type { DailyTrendPoint } from '@/modules/session/domain/session-entity/model/session-records'
import { WidgetErrorBoundary } from '@/shared/components/widget-error-boundary'
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
      {/* 没有边界时，图表 chunk 加载失败只会留下一个永远脉动的灰块。 */}
      <WidgetErrorBoundary label="趋势图表" className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
        <Suspense fallback={<ChartSkeleton />}>
          <TimeRecordsTrendChartView trend={trend} />
        </Suspense>
      </WidgetErrorBoundary>
    </div>
  )
}

export const TimeRecordsTrendChart = memo(TimeRecordsTrendChartComponent)
