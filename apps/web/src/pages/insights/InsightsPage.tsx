import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardQuery, DashboardResponse } from '@/shared/api/contracts'
import { DashboardSkeleton } from '@/modules/dashboard/public'
import { ErrorState } from '@/shared/components/state-placeholders'
import { TimeRecordDialog } from '@/modules/settings/public'
import { TimeRecordQuickAddDialog } from '@/modules/settings/public'
import { TimeRecordsBreakdownChart } from '@/modules/settings/public'
import { TimeRecordsTable } from '@/modules/settings/public'
import { TimeRecordsTrendChart } from '@/modules/settings/public'
import { useTimeRecordsDashboard } from '@/modules/settings/public'
import { getDashboardApi } from '@/modules/dashboard/public'
import { DashboardNewPalacesCard } from '@/modules/dashboard/public'
import { DashboardQuickActions } from '@/modules/dashboard/public'
import {
  DashboardStatCards,
  getTodayTodoTotal,
} from '@/modules/dashboard/public'
import { DashboardTodayLearningCard } from '@/modules/dashboard/public'
import { ReviewNotesCard } from '@/modules/dashboard/public'
import { StudyHeatmap } from '@/modules/dashboard/public'
import { TimeRecordChartCard } from '@/modules/dashboard/public'
import { WeeklyGoalsCard } from '@/modules/dashboard/public'
import { WeeklyReportCard } from '@/modules/dashboard/public'
import {
  DASHBOARD_TOTAL_DURATION_FILTER_STORAGE_KEY,
  createDefaultDurationFilterState,
  formatTrendCardTitle,
  hasDurationFilterStateChanged,
  isDashboardDurationFilterState,
  isDefaultDurationFilterState,
  normalizeDashboardDurationFilterState,
  type DashboardDurationFilterState,
  type NormalizedDashboardDurationFilterState,
} from '@/modules/dashboard/public'
import { Button } from '@/shared/components/ui/button'
import { useLocalStorageState } from '@/shared/lib/localStorage'

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [durationFilter, setDurationFilter] = useLocalStorageState<DashboardDurationFilterState>(
    DASHBOARD_TOTAL_DURATION_FILTER_STORAGE_KEY,
    createDefaultDurationFilterState(),
    isDashboardDurationFilterState,
    'dashboard_duration_filter',
  )
  const normalizedDurationFilter = normalizeDashboardDurationFilterState(
    durationFilter,
  )
  const {
    mode: durationMode,
    month: selectedMonth,
    startDate: rangeStartDate,
    endDate: rangeEndDate,
    trendRangeDays,
    breakdownRangeDays,
  } = normalizedDurationFilter
  const hasInitializedSelectedDurationRef = useRef(false)
  const [hasLoadedDashboard, setHasLoadedDashboard] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const updateDurationFilter = useCallback(
    (
      updater:
        | Partial<DashboardDurationFilterState>
        | ((
            current: NormalizedDashboardDurationFilterState,
          ) => Partial<DashboardDurationFilterState>),
    ) => {
      setDurationFilter((current) => {
        const normalizedCurrent = normalizeDashboardDurationFilterState(current)
        const patch =
          typeof updater === 'function' ? updater(normalizedCurrent) : updater
        return normalizeDashboardDurationFilterState({
          ...normalizedCurrent,
          ...patch,
        })
      })
    },
    [setDurationFilter],
  )

  const loadDashboard = useCallback(async () => {
    setLoadError(null)
    try {
      const dashboard = await getDashboardApi()
      setData(dashboard)
      setHasLoadedDashboard(true)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载仪表盘失败。')
      throw error
    }
  }, [])

  const loadSelectedDuration = useCallback(async (query: DashboardQuery) => {
    const dashboard = await getDashboardApi(query)
    setData((current) => {
      if (!current) return dashboard
      return {
        ...current,
        selected_total_review_duration_seconds: dashboard.selected_total_review_duration_seconds,
      }
    })
  }, [])
  const timeRecordsDashboard = useTimeRecordsDashboard({
    onRecordsChanged: loadDashboard,
    trendRange: trendRangeDays,
    breakdownRange: breakdownRangeDays,
  })

  useEffect(() => {
    void loadDashboard().catch(() => undefined)
  }, [loadDashboard])

  useEffect(() => {
    if (
      hasDurationFilterStateChanged(durationFilter, normalizedDurationFilter)
    ) {
      setDurationFilter(normalizedDurationFilter)
    }
  }, [durationFilter, normalizedDurationFilter, setDurationFilter])

  useEffect(() => {
    if (!hasLoadedDashboard) return
    if (!hasInitializedSelectedDurationRef.current) {
      hasInitializedSelectedDurationRef.current = true
      if (isDefaultDurationFilterState(normalizedDurationFilter)) {
        return
      }
    }
    if (durationMode === 'month') {
      if (!selectedMonth) return
      void loadSelectedDuration({
        duration_mode: 'month',
        month: selectedMonth,
      })
      return
    }
    if (durationMode === 'all') {
      void loadSelectedDuration({
        duration_mode: 'all',
      })
      return
    }
    if (!rangeStartDate || !rangeEndDate) return
    if (rangeStartDate > rangeEndDate) return
    void loadSelectedDuration({
      duration_mode: 'range',
      start_date: rangeStartDate,
      end_date: rangeEndDate,
    })
  }, [durationMode, hasLoadedDashboard, loadSelectedDuration, normalizedDurationFilter, rangeEndDate, rangeStartDate, selectedMonth])

  if (!data && loadError) {
    return (
      <ErrorState
        title="仪表盘加载失败"
        description={loadError}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void loadDashboard().catch(() => undefined)}>
            重新加载
          </Button>
        }
      />
    )
  }

  if (!data) {
    return <DashboardSkeleton />
  }

  const todayTodoTotal = getTodayTodoTotal(data)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
      </div>

      <DashboardStatCards
        data={data}
        durationFilter={normalizedDurationFilter}
        onUpdateDurationFilter={updateDurationFilter}
      />

      <DashboardQuickActions todayTodoTotal={todayTodoTotal} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WeeklyGoalsCard />
        <WeeklyReportCard />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardTodayLearningCard palaces={data.today_learning_palaces} />
        <DashboardNewPalacesCard data={data} />
      </div>

      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TimeRecordChartCard
            title={formatTrendCardTitle(trendRangeDays)}
            selectedRange={trendRangeDays}
            onRangeChange={(range) =>
              updateDurationFilter({ trendRangeDays: range })
            }
          >
            <TimeRecordsTrendChart
              trend={timeRecordsDashboard.trend}
            />
          </TimeRecordChartCard>
          <TimeRecordChartCard
            title="标签时长分布"
            selectedRange={breakdownRangeDays}
            onRangeChange={(range) =>
              updateDurationFilter({ breakdownRangeDays: range })
            }
          >
            <TimeRecordsBreakdownChart
              breakdown={timeRecordsDashboard.breakdown}
            />
          </TimeRecordChartCard>
        </div>

        <StudyHeatmap />

        <ReviewNotesCard />

        <TimeRecordsTable
          thresholdInput={timeRecordsDashboard.thresholdInput}
          onThresholdInputChange={timeRecordsDashboard.setThresholdInput}
          onThresholdBlur={() => void timeRecordsDashboard.applyThreshold()}
          showBelowThreshold={timeRecordsDashboard.showBelowThreshold}
          onShowBelowThresholdChange={timeRecordsDashboard.setShowBelowThreshold}
          keyword={timeRecordsDashboard.keyword}
          onKeywordChange={timeRecordsDashboard.setKeyword}
          kindFilter={timeRecordsDashboard.kindFilter}
          onKindFilterChange={timeRecordsDashboard.setKindFilter}
          sortBy={timeRecordsDashboard.sortBy}
          onSortByChange={timeRecordsDashboard.setSortBy}
          sortOrder={timeRecordsDashboard.sortOrder}
          onSortOrderChange={timeRecordsDashboard.setSortOrder}
          page={timeRecordsDashboard.page}
          pageSize={timeRecordsDashboard.pageSize}
          totalRecords={timeRecordsDashboard.totalRecords}
          totalPages={timeRecordsDashboard.totalPages}
          onPageChange={timeRecordsDashboard.setPage}
          onPageSizeChange={timeRecordsDashboard.setPageSize}
          isLoadingRecords={timeRecordsDashboard.isLoadingRecords}
          recordsError={timeRecordsDashboard.recordsError}
          showDeleted={timeRecordsDashboard.showDeleted}
          onShowDeletedChange={timeRecordsDashboard.setShowDeleted}
          onCreateRecord={timeRecordsDashboard.openCreateDialog}
          onBulkDelete={() => void timeRecordsDashboard.handleBulkDelete()}
          bulkDeleteDisabled={!timeRecordsDashboard.hasSelectedRecords}
          isBulkDeleting={timeRecordsDashboard.isBulkDeleting}
          deletingRecordId={timeRecordsDashboard.deletingRecordId}
          visibleRecords={timeRecordsDashboard.visibleRecords}
          pendingRecoveryRecords={timeRecordsDashboard.pendingRecoveryRecords}
          hasSelectableRecords={timeRecordsDashboard.hasSelectableRecords}
          allSelectableChecked={timeRecordsDashboard.allSelectableChecked}
          selectedRecordIds={timeRecordsDashboard.selectedRecordIds}
          onToggleSelectAllVisible={
            timeRecordsDashboard.toggleSelectAllVisible
          }
          onToggleRecordSelection={timeRecordsDashboard.toggleRecordSelection}
          onEditRecord={timeRecordsDashboard.openEditDialog}
          onDeleteRecord={timeRecordsDashboard.handleDeleteRecord}
          onReplayPendingRecovery={
            timeRecordsDashboard.handleReplayPendingRecovery
          }
          onDismissPendingRecovery={
            timeRecordsDashboard.handleDismissPendingRecovery
          }
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

