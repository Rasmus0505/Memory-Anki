import { useState } from 'react'
import {
  DashboardNewPalacesCard,
  StudyHeatmap,
  useDashboardOverview,
} from '@/modules/dashboard/public'
import {
  ExamCountdownBlock,
  ExamRecentBlock,
  ExamTodayBlock,
  ExamWeakBlock,
  useExamOverview,
} from '@/modules/exam/public'
import { PageContainer } from '@/shared/components/layout/PageLayout'
import { ErrorState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { InsightsPageLoading } from '@/pages/insights/InsightsPageLoading'

type OverviewPane = 'exam' | 'activity' | 'palaces'

const OVERVIEW_PANES: Array<{ value: OverviewPane; label: string }> = [
  { value: 'exam', label: '考试' },
  { value: 'activity', label: '动态' },
  { value: 'palaces', label: '宫殿' },
]

// 窄屏一次只显示一栏，由分段按钮切换；lg 以上所有栏同时显示。
function PaneSwitch<T extends string>({ panes, value, onChange, label }: {
  panes: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    // Phones: the switch is the page's only navigation, so it takes the full
    // row instead of hugging the right edge under the title.
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 items-center rounded-lg bg-muted p-1 max-sm:flex max-sm:w-full lg:hidden"
    >
      {panes.map((pane) => (
        <button
          key={pane.value}
          type="button"
          aria-pressed={value === pane.value}
          onClick={() => onChange(pane.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-200 max-sm:flex-1',
            value === pane.value && 'bg-card text-foreground shadow-[0_0_0_1px_var(--color-border),0_1px_3px_rgb(0_0_0/0.08)]',
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
  const { data, error: loadError, reload: loadDashboard } = useDashboardOverview()
  const [overviewPane, setOverviewPane] = useState<OverviewPane>('exam')
  const { data: examOverview, error: examError } = useExamOverview()

  if (!data && loadError) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          title="洞察加载失败"
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

  const examPlaceholder = (
    <section className="flex shrink-0 items-center justify-center rounded-xl border border-border/80 bg-card p-4 text-sm text-muted-foreground shadow-card">
      {examError ? `考试概览加载失败：${examError}` : '正在加载考试概览…'}
    </section>
  )

  return (
    <PageContainer wide className="dashboard-fit gap-3">
      <div className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-2 px-1 pt-1">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight sm:text-[32px] sm:leading-[1.15]">洞察</h1>
          <p className="ma-figure text-[12px] text-muted-foreground">
            {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}
          </p>
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <PaneSwitch<OverviewPane> panes={OVERVIEW_PANES} value={overviewPane} onChange={setOverviewPane} label="概览分区" />
        </div>
      </div>

      {examOverview ? (
        <ExamTodayBlock
          overview={examOverview}
          primary
          className="shrink-0 rounded-none border-0 border-b border-border bg-transparent px-0 pb-5 pt-0 shadow-none"
        />
      ) : examPlaceholder}

      {/* lg: exam on the left; activity and new palaces share the right column. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className={paneClass(overviewPane === 'exam')}>
          {examOverview ? (
            <>
              <ExamCountdownBlock overview={examOverview} className="shrink-0" />
              <ExamWeakBlock overview={examOverview} className="min-h-40 flex-1" />
            </>
          ) : null}
        </div>

        <div className="contents lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:overflow-y-auto">
          <div className={cn(paneClass(overviewPane === 'activity'), 'lg:overflow-visible')}>
            {examOverview ? <ExamRecentBlock overview={examOverview} className="shrink-0" /> : null}
            <StudyHeatmap className="shrink-0" />
          </div>

          <div className={cn(paneClass(overviewPane === 'palaces'), 'lg:flex-1 lg:overflow-visible')}>
            <DashboardNewPalacesCard
              data={data}
              className={data.today_new_palace_count > 0 ? 'min-h-45 flex-1' : 'shrink-0'}
            />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
