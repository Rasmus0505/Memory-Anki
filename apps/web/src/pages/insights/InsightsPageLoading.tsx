import { DashboardSkeleton } from '@/modules/dashboard/public'
import { PageContainer } from '@/shared/components/layout/PageLayout'

/** Shown while the dashboard route chunk or overview request is still in flight. */
export function InsightsPageLoading() {
  return (
    <PageContainer wide className="dashboard-fit gap-3">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
        <p className="text-sm text-muted-foreground">正在加载学习概览...</p>
      </div>
      <DashboardSkeleton />
    </PageContainer>
  )
}
