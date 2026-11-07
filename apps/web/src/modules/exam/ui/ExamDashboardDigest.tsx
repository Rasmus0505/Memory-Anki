import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ExamOverview } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Ledger, LedgerRow } from '@/shared/components/ui/ledger'
import { RollingNumber } from '@/shared/components/ui/rolling-number'
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
    <section className={cn('flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium tracking-[0.02em] text-muted-foreground">{question}</h2>
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

export function ExamTodayBlock({ overview, className, primary = false }: ExamDigestBlockProps & { primary?: boolean }) {
  const topToday = overview.palaces.filter((row) => row.unit_count > 0).slice(0, 3)
  return (
    <Block
      question="今天该学什么"
      className={cn(primary && 'p-5', className)}
      action={
        primary ? (
          <Button asChild size="lg" title="在随心配置里选「考试优先」，会按这个顺序出卡">
            <Link to="/freestyle">开始今日复习</Link>
          </Button>
        ) : (
          <Button asChild size="sm" className="h-7">
            <Link to="/freestyle">开始</Link>
          </Button>
        )
      }
    >
      <div className={cn('flex flex-col gap-3', primary && 'sm:flex-row sm:items-center sm:gap-8')}>
        <p className={cn('ma-figure shrink-0 font-semibold leading-none tabular-nums', primary ? 'text-5xl sm:text-[56px]' : 'text-3xl')}>
          <RollingNumber value={overview.totals.due_today} />
          <span className="ml-1.5 text-sm font-normal tracking-normal text-muted-foreground">个单元到期</span>
        </p>
        {topToday.length > 0 ? (
          <ul className={cn('flex min-w-0 flex-1 flex-col gap-1 text-sm', primary && 'sm:border-l sm:border-border/70 sm:pl-6')}>
            {topToday.map((row) => (
              <li key={row.id} className="flex items-center gap-2">
                <ExamStarBadge stars={row.stars} className="w-12 shrink-0" />
                <Link to={`/palaces/${row.id}`} className="min-w-0 flex-1 truncate rounded-sm transition-colors hover:text-primary">{row.title}</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Block>
  )
}

export function ExamCountdownBlock({ overview, className }: ExamDigestBlockProps) {
  const { totals } = overview
  return (
    <Block question="离考试还差多少" className={className} action={<Link to="/exam" className="rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft">作战室 →</Link>}>
      <p className="text-sm text-muted-foreground">{formatDaysLeft(overview.days_left)}</p>
      <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
        <span className="ma-figure text-[32px] font-semibold">{formatPercent(totals.mastery_ratio)}</span>
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
      <Ledger>
        {[
          { value: String(totals.study_days), label: '累计学习天数' },
          { value: `${recentDays}/7`, label: '近 7 天学习' },
          { value: formatPercent(passRate), label: '近 7 天通过率' },
        ].map((item) => (
          <LedgerRow key={item.label} label={item.label} value={item.value} />
        ))}
      </Ledger>
      <p className="text-xs text-muted-foreground">今天已评分 {totals.reviewed_today} 次</p>
    </Block>
  )
}

export function ExamWeakBlock({ overview, className }: ExamDigestBlockProps) {
  return (
    <Block question="哪里最薄弱" className={className}>
      {/* Windows draws an overlay scrollbar over the last column; keep the
          counts clear of it instead of letting "0/5" sit under the thumb. */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        <ExamWeakList rows={overview.weak.slice(0, 8)} />
      </div>
    </Block>
  )
}
