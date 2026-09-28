import { DashboardSkeleton } from '@/modules/dashboard/public'

/** Shown while the dashboard route chunk or overview request is still in flight. */
export function InsightsPageLoading() {
  return (
    <div className="dashboard-fit flex flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
        <p className="text-sm text-muted-foreground">正在加载学习概览...</p>
      </div>
      <DashboardSkeleton />
    </div>
  )
}
