import { useCallback, useEffect, useRef, useState } from 'react'
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
  DashboardStatCards,
  DashboardTodayLearningCard,
  StudyHeatmap,
  TimeRecordChartCard,
  getDashboardApi,
  invalidateDashboardApi,
} from '@/modules/dashboard/public'
import {
  ExamCountdownBlock,
  ExamRecentBlock,
  ExamTodayBlock,
  ExamWeakBlock,
  useExamOverview,
} from '@/modules/exam/public'
import { ErrorState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { cn } from '@/shared/lib/utils'
import { InsightsPageLoading } from '@/pages/insights/InsightsPageLoading'

type DashboardTab = 'overview' | 'records'
type OverviewPane = 'exam' | 'time' | 'palaces'
type RecordsPane = 'list' | 'charts'

const OVERVIEW_PANES: Array<{ value: OverviewPane; label: string }> = [
  { value: 'exam', label: '考试' },
  { value: 'time', label: '时长' },
  { value: 'palaces', label: '宫殿' },
]

const RECORDS_PANES: Array<{ value: RecordsPane; label: string }> = [
  { value: 'list', label: '列表' },
  { value: 'charts', label: '图表' },
]

// 窄屏一次只显示一栏，由分段按钮切换；lg 以上所有栏同时显示。
function PaneSwitch<T extends string>({ panes, value, onChange, label }: {
  panes: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-9 items-center rounded-lg bg-muted p-1 lg:hidden">
      {panes.map((pane) => (
        <button
          key={pane.value}
          type="button"
          aria-pressed={value === pane.value}
          onClick={() => onChange(pane.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground transition-all',
            value === pane.value && 'bg-background text-foreground shadow',
          )}
        >
          {pane.label}
        </button>
      ))}
    </div>
  )
}

function paneClass(active: boolean) {
  return cn('min-h-0 flex-col gap-3 overflow-y-auto lg:flex', active ? 'flex' : 'hidden')
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<DashboardTab>('overview')
  const [overviewPane, setOverviewPane] = useState<OverviewPane>('exam')
  const [recordsPane, setRecordsPane] = useState<RecordsPane>('list')
  const dashboardRequestIdRef = useRef(0)

  const loadDashboard = useCallback(async (): Promise<void> => {
    const requestId = ++dashboardRequestIdRef.current
    setLoadError(null)
    try {
      invalidateDashboardApi()
      const dashboard = await getDashboardApi()
      if (requestId !== dashboardRequestIdRef.current) return
      setData(dashboard)
    } catch (error) {
      if (requestId !== dashboardRequestIdRef.current) return
      setLoadError(error instanceof Error ? error.message : '加载仪表盘失败。')
      throw error
    }
  }, [])

  const { data: examOverview, error: examError } = useExamOverview()
  const timeRecordsDashboard = useTimeRecordsDashboard({
    onRecordsChanged: loadDashboard,
  })

  useEffect(() => {
    void loadDashboard().catch(() => undefined)
  }, [loadDashboard])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      void loadDashboard().catch(() => undefined)
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadDashboard])

  if (!data && loadError) {
    return (
      <div className="flex flex-col gap-4">
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
    return <InsightsPageLoading />
  }

  const rangeLabel = formatTimeRecordRangeLabel(timeRecordsDashboard.filter)
  const examPlaceholder = (
    <section className="flex shrink-0 items-center justify-center rounded-3xl bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border/60">
      {examError ? `考试概览加载失败：${examError}` : '正在加载考试概览…'}
    </section>
  )

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as DashboardTab)} className="dashboard-fit flex flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {/* 窄屏左上角浮着全局返回按钮、右上角是录制浮标：标题独占一行并让出两侧。 */}
        <h1 className="basis-full pl-[5.5rem] pr-12 text-2xl font-semibold leading-9 tracking-tight lg:basis-auto lg:p-0">仪表盘</h1>
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="records">记录</TabsTrigger>
        </TabsList>
        <div className="ml-auto">
          {tab === 'overview' ? (
            <PaneSwitch<OverviewPane> panes={OVERVIEW_PANES} value={overviewPane} onChange={setOverviewPane} label="概览分区" />
          ) : (
            <PaneSwitch<RecordsPane> panes={RECORDS_PANES} value={recordsPane} onChange={setRecordsPane} label="记录分区" />
          )}
        </div>
      </div>

      <TabsContent
        value="overview"
        className="mt-0 grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]"
      >
        <div className={paneClass(overviewPane === 'exam')}>
          {examOverview ? (
            <>
              <ExamCountdownBlock overview={examOverview} className="shrink-0" />
              <ExamTodayBlock overview={examOverview} className="shrink-0" />
              <ExamWeakBlock overview={examOverview} className="min-h-[160px] flex-1" />
            </>
          ) : examPlaceholder}
        </div>

        <div className={paneClass(overviewPane === 'time')}>
          <DashboardStatCards
            data={data}
            timeRecordFilter={timeRecordsDashboard.filter}
            timeRecordSummary={timeRecordsDashboard.sourceSummary}
          />
          {examOverview ? <ExamRecentBlock overview={examOverview} className="shrink-0" /> : null}
          <StudyHeatmap className="shrink-0" />
        </div>

        <div className={paneClass(overviewPane === 'palaces')}>
          <DashboardTodayLearningCard palaces={data.today_learning_palaces} className="min-h-[200px] flex-1" />
          <DashboardNewPalacesCard data={data} className="min-h-[180px] flex-1" />
        </div>
      </TabsContent>

      <TabsContent value="records" className="mt-0 flex min-h-0 flex-1 flex-col gap-3">
        <div
          className={cn(
            'min-h-0 grid-cols-1 gap-3 lg:grid lg:h-[220px] lg:flex-none lg:grid-cols-2 lg:grid-rows-1 2xl:h-[260px]',
            recordsPane === 'charts' ? 'grid flex-1 grid-rows-2' : 'hidden',
          )}
        >
          <TimeRecordChartCard title={`时长趋势 · ${rangeLabel}`}>
            <TimeRecordsTrendChart trend={timeRecordsDashboard.trend} className="h-full min-h-0" />
          </TimeRecordChartCard>
          <TimeRecordChartCard title={`标签时长分布 · ${rangeLabel}`}>
            <TimeRecordsBreakdownChart breakdown={timeRecordsDashboard.breakdown} className="h-full min-h-0" />
          </TimeRecordChartCard>
        </div>

        <TimeRecordsTable
          className={cn('flex-1 lg:flex', recordsPane === 'list' ? 'flex' : 'hidden')}
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
      </TabsContent>

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
        sceneSegments={timeRecordsDashboard.editingSceneSegments}
        error={timeRecordsDashboard.formError}
        isSubmitting={timeRecordsDashboard.isSubmittingRecord}
        onOpenChange={timeRecordsDashboard.onDialogOpenChange}
        onChange={timeRecordsDashboard.onFormChange}
        onSubmit={(event) => void timeRecordsDashboard.handleSubmitRecord(event)}
      />
    </Tabs>
  )
}
