import { DashboardSkeleton } from '@/modules/dashboard/public'
import { InsightsSectionNav } from '@/pages/insights/InsightsSectionNav'

/** Shown while the dashboard route chunk or overview request is still in flight. */
export function InsightsPageLoading() {
  return (
    <div className="flex flex-col gap-4">
      <InsightsSectionNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
        <p className="mt-1 text-sm text-muted-foreground">正在加载学习概览...</p>
      </div>
      <DashboardSkeleton />
    </div>
  )
}
