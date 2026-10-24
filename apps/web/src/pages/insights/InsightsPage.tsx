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
            'rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground transition-all max-sm:flex-1',
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
  const { data, error: loadError, reload: loadDashboard } = useDashboardOverview()
  const [overviewPane, setOverviewPane] = useState<OverviewPane>('exam')
  const { data: examOverview, error: examError } = useExamOverview()

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

  const examPlaceholder = (
    <section className="flex shrink-0 items-center justify-center rounded-3xl bg-card p-4 text-sm text-muted-foreground shadow-sm ring-1 ring-border/60">
      {examError ? `考试概览加载失败：${examError}` : '正在加载考试概览…'}
    </section>
  )

  return (
    <PageContainer wide className="dashboard-fit gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 sm:gap-y-2">
        {/* 窄屏左上角浮着全局返回按钮、右上角是录制浮标：标题独占一行并让出两侧。 */}
        <h1 className="basis-full pl-22 pr-12 text-xl font-semibold leading-7 tracking-tight sm:text-2xl sm:leading-9 lg:basis-auto lg:p-0">仪表盘</h1>
        <div className="w-full sm:ml-auto sm:w-auto">
          <PaneSwitch<OverviewPane> panes={OVERVIEW_PANES} value={overviewPane} onChange={setOverviewPane} label="概览分区" />
        </div>
      </div>

      {examOverview ? (
        <ExamTodayBlock overview={examOverview} primary className="shrink-0" />
      ) : examPlaceholder}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className={paneClass(overviewPane === 'exam')}>
          {examOverview ? (
            <>
              <ExamCountdownBlock overview={examOverview} className="shrink-0" />
              <ExamWeakBlock overview={examOverview} className="min-h-40 flex-1" />
            </>
          ) : null}
        </div>

        <div className={paneClass(overviewPane === 'activity')}>
          {examOverview ? <ExamRecentBlock overview={examOverview} className="shrink-0" /> : null}
          <StudyHeatmap className="shrink-0" />
        </div>

        <div className={paneClass(overviewPane === 'palaces')}>
          <DashboardNewPalacesCard data={data} className="min-h-45 flex-1" />
        </div>
      </div>
    </PageContainer>
  )
}
