import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ExamOverview } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { formatDaysLeft, formatPercent } from '../model/examFormat'
import { ExamStarBadge } from './ExamStarBadge'
import { ExamWeakList } from './warroom/ExamSummaryPanels'

interface ExamDigestBlockProps {
  overview: ExamOverview
  className?: string
}

function Block({ question, children, action, className }: { question: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-h-0 flex-col gap-2 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border/60', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{question}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

function weekPassRate(overview: ExamOverview): number | null {
  const recent = overview.retention.observed.slice(-7)
  const reviews = recent.reduce((sum, row) => sum + row.reviews, 0)
  if (!reviews) return null
  const passes = recent.reduce((sum, row) => sum + (row.pass_rate ?? 0) * row.reviews, 0)
  return passes / reviews
}

export function ExamTodayBlock({ overview, className }: ExamDigestBlockProps) {
  const topToday = overview.palaces.filter((row) => row.unit_count > 0).slice(0, 3)
  return (
    <Block
      question="今天该学什么"
      className={className}
      action={
        <Button asChild size="sm" className="h-7">
          <Link to="/freestyle">开始</Link>
        </Button>
      }
    >
      <p className="text-3xl font-semibold tabular-nums">
        {overview.totals.due_today}
        <span className="ml-1.5 text-sm font-normal text-muted-foreground">个单元到期</span>
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {topToday.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <ExamStarBadge stars={row.stars} className="w-12 shrink-0" />
            <Link to={`/palaces/${row.id}`} className="min-w-0 flex-1 truncate hover:underline">{row.title}</Link>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">在随心配置里选「考试优先」，会按这个顺序出卡。</p>
    </Block>
  )
}

export function ExamCountdownBlock({ overview, className }: ExamDigestBlockProps) {
  const { totals } = overview
  return (
    <Block question="离考试还差多少" className={className} action={<Link to="/exam" className="text-xs text-primary hover:underline">作战室 →</Link>}>
      <p className="text-sm text-muted-foreground">{formatDaysLeft(overview.days_left)}</p>
      <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
        <span className="text-3xl font-semibold">{formatPercent(totals.mastery_ratio)}</span>
        <span className="text-sm text-muted-foreground">→ 考前预测 {formatPercent(totals.predicted_ratio)}</span>
      </div>
      <div className="relative h-2 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: `${totals.predicted_ratio * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${totals.mastery_ratio * 100}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {overview.days_left && overview.days_left > 0
          ? `按目前每天新学 ${totals.pace_per_day} 个；学完剩余需要每天 ${totals.needed_per_day} 个`
          : '在作战室设置考试日期后显示每日所需进度'}
      </p>
    </Block>
  )
}

export function ExamRecentBlock({ overview, className }: ExamDigestBlockProps) {
  const { totals } = overview
  const recentDays = overview.retention.observed.slice(-7).filter((row) => row.reviews > 0).length
  const passRate = weekPassRate(overview)
  return (
    <Block question="最近学得怎么样" className={className}>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[
          { value: String(totals.study_days), label: '累计学习天数' },
          { value: `${recentDays}/7`, label: '近 7 天学习' },
          { value: formatPercent(passRate), label: '近 7 天通过率' },
        ].map((item) => (
          <div key={item.label} className="min-w-0 rounded-2xl bg-muted/50 px-1 py-2">
            <div className="text-xl font-semibold tabular-nums">{item.value}</div>
            <div className="truncate text-[11px] text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">今天已评分 {totals.reviewed_today} 次</p>
    </Block>
  )
}

export function ExamWeakBlock({ overview, className }: ExamDigestBlockProps) {
  return (
    <Block question="哪里最薄弱" className={className}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ExamWeakList rows={overview.weak.slice(0, 8)} />
      </div>
    </Block>
  )
}
