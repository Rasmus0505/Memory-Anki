import { useCallback, useEffect, useState } from 'react'
import type { DashboardResponse } from '@/shared/api/contracts'
import {
  TimeRecordDialog,
  TimeRecordQuickAddDialog,
  TimeRecordsBreakdownChart,
  TimeRecordsTable,
  TimeRecordsTrendChart,
  formatTimeRecordRangeLabel,
  useTimeRecordsDashboard,
} from '@/modules/session/public'
import {
  DashboardNewPalacesCard,
  DashboardSkeleton,
  DashboardStatCards,
  DashboardTodayLearningCard,
  StudyHeatmap,
  TimeRecordChartCard,
  getDashboardApi,
} from '@/modules/dashboard/public'
import { ErrorState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { InsightsSectionNav } from '@/pages/insights/InsightsSectionNav'

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoadError(null)
    try {
      const dashboard = await getDashboardApi()
      setData(dashboard)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载仪表盘失败。')
      throw error
    }
  }, [])

  const timeRecordsDashboard = useTimeRecordsDashboard({
    onRecordsChanged: loadDashboard,
  })

  useEffect(() => {
    void loadDashboard().catch(() => undefined)
  }, [loadDashboard])

  if (!data && loadError) {
    return (
      <div className="flex flex-col gap-4">
        <InsightsSectionNav />
        <ErrorState
          title="仪表盘加载失败"
          description={loadError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void loadDashboard().catch(() => undefined)}>
              重新加载
            </Button>
          }
        />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <InsightsSectionNav />
        <DashboardSkeleton />
      </div>
    )
  }

  const rangeLabel = formatTimeRecordRangeLabel(timeRecordsDashboard.filter)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <InsightsSectionNav />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            时长统计、时间记录与学习概览
          </p>
        </div>
      </div>

      <DashboardStatCards
        data={data}
        timeRecordFilter={timeRecordsDashboard.filter}
        timeRecordSummary={timeRecordsDashboard.sourceSummary}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <DashboardTodayLearningCard palaces={data.today_learning_palaces} />
        <div className="flex flex-col gap-6">
          <DashboardNewPalacesCard data={data} />
          <StudyHeatmap />
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TimeRecordChartCard title={`时长趋势 · ${rangeLabel}`}>
            <TimeRecordsTrendChart trend={timeRecordsDashboard.trend} />
          </TimeRecordChartCard>
          <TimeRecordChartCard title={`标签时长分布 · ${rangeLabel}`}>
            <TimeRecordsBreakdownChart breakdown={timeRecordsDashboard.breakdown} />
          </TimeRecordChartCard>
        </div>

        <TimeRecordsTable
          filter={timeRecordsDashboard.filter}
          onRangeModeChange={timeRecordsDashboard.setRangeMode}
          onMonthChange={timeRecordsDashboard.setMonth}
          onRollingDaysChange={timeRecordsDashboard.setRollingDays}
          onStartDateChange={timeRecordsDashboard.setStartDate}
          onEndDateChange={timeRecordsDashboard.setEndDate}
          keyword={timeRecordsDashboard.keyword}
          onKeywordChange={timeRecordsDashboard.setKeyword}
          kindFilter={timeRecordsDashboard.kindFilter}
          onKindFilterChange={timeRecordsDashboard.setKindFilter}
          sortBy={timeRecordsDashboard.sortBy}
          onSortByChange={timeRecordsDashboard.setSortBy}
          sortOrder={timeRecordsDashboard.sortOrder}
          onSortOrderChange={timeRecordsDashboard.setSortOrder}
          sourceSummary={timeRecordsDashboard.sourceSummary}
          page={timeRecordsDashboard.page}
          pageSize={timeRecordsDashboard.pageSize}
          totalRecords={timeRecordsDashboard.totalRecords}
          totalPages={timeRecordsDashboard.totalPages}
          onPageChange={timeRecordsDashboard.setPage}
          onPageSizeChange={timeRecordsDashboard.setPageSize}
          isLoadingRecords={timeRecordsDashboard.isLoadingRecords}
          recordsError={timeRecordsDashboard.recordsError}
          onCreateRecord={timeRecordsDashboard.openCreateDialog}
          onBulkDelete={() => void timeRecordsDashboard.handleBulkDelete()}
          bulkDeleteDisabled={!timeRecordsDashboard.hasSelectedRecords}
          isBulkDeleting={timeRecordsDashboard.isBulkDeleting}
          deletingRecordId={timeRecordsDashboard.deletingRecordId}
          visibleRecords={timeRecordsDashboard.visibleRecords}
          hasSelectableRecords={timeRecordsDashboard.hasSelectableRecords}
          allSelectableChecked={timeRecordsDashboard.allSelectableChecked}
          selectedRecordIds={timeRecordsDashboard.selectedRecordIds}
          onToggleSelectAllVisible={timeRecordsDashboard.toggleSelectAllVisible}
          onToggleRecordSelection={timeRecordsDashboard.toggleRecordSelection}
          onEditRecord={timeRecordsDashboard.openEditDialog}
          onDeleteRecord={timeRecordsDashboard.handleDeleteRecord}
        />
      </div>

      <TimeRecordQuickAddDialog
        open={timeRecordsDashboard.quickAddOpen}
        form={timeRecordsDashboard.quickAddForm}
        customTags={timeRecordsDashboard.customTags}
        error={timeRecordsDashboard.quickAddError}
        isSubmitting={timeRecordsDashboard.isSubmittingQuickAdd}
        onOpenChange={timeRecordsDashboard.onQuickAddOpenChange}
        onChange={timeRecordsDashboard.onQuickAddFormChange}
        onCustomTagsChange={timeRecordsDashboard.onCustomTagsChange}
        onSubmit={(event) => void timeRecordsDashboard.handleSubmitQuickAdd(event)}
      />

      <TimeRecordDialog
        open={timeRecordsDashboard.dialogOpen}
        mode={timeRecordsDashboard.dialogMode}
        form={timeRecordsDashboard.formState}
        customTags={timeRecordsDashboard.customTags}
        error={timeRecordsDashboard.formError}
        isSubmitting={timeRecordsDashboard.isSubmittingRecord}
        onOpenChange={timeRecordsDashboard.onDialogOpenChange}
        onChange={timeRecordsDashboard.onFormChange}
        onSubmit={(event) => void timeRecordsDashboard.handleSubmitRecord(event)}
      />
    </div>
  )
}
