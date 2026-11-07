import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import { Metric } from '@/shared/components/ui/metric'
import { cn } from '@/shared/lib/utils'
import { formatPalaceUnit } from '@/modules/practice/ui/freestyle/model/formatPalaceUnit'

interface FreestyleStartOverviewProps {
  overview: FreestyleOverviewResponse | null
  loading?: boolean
  error?: boolean
  onStart: () => void
  onRetry?: () => void
  startDisabled?: boolean
  /** The dismissible 昨日回顾 card is already above this panel. */
  hideYesterday?: boolean
}

const startButtonClass =
  'ma-pressable inline-flex h-11 items-center justify-center rounded-lg bg-stage-glow px-5 text-sm font-semibold tracking-[0.04em] text-stage shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_24px_-8px_color-mix(in_oklab,var(--color-stage-glow)_70%,transparent)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stage-glow/60 focus-visible:ring-offset-2 focus-visible:ring-offset-stage disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none'

export function FreestyleStartOverview({
  overview,
  loading = false,
  error = false,
  onStart,
  onRetry,
  startDisabled = false,
  hideYesterday = false,
}: FreestyleStartOverviewProps) {
  if (error) {
    return (
      <section className="flex flex-col gap-4 rounded-2xl border border-stage-line bg-surface-stage-raised p-5 text-ink-stage">
        <p className="text-sm text-ink-stage-muted">概览暂时读取失败，仍可直接开始学习。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onStart} disabled={startDisabled} className={startButtonClass}>
            直接开始学习
          </button>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="rounded-xl px-4 py-2.5 text-sm text-stage-glow underline">
              重试概览
            </button>
          ) : null}
        </div>
      </section>
    )
  }

  const round = overview?.round ?? null
  const today = overview?.today ?? null
  const yesterday = overview?.yesterday ?? null
  const counts = round?.counts ?? null
  const dueUnits = today ? today.due_count : null
  const duePalaces = today ? today.due_palace_count : null
  const newUnits = today ? today.new_unit_count : null
  const newPalaces = today ? today.new_palace_count : null
  const hasWork = (counts?.remaining ?? 0) > 0 || (dueUnits ?? 0) > 0 || (newUnits ?? 0) > 0
  const weakUnits = yesterday?.weak_units ?? []
  // Already normalized at the API boundary; read the list defensively anyway so a
  // shape change can only drop this glance strip, never the whole start page.
  const milestoneDays = overview?.milestones?.groups ?? []
  const hasSideColumn = milestoneDays.length > 0 || Boolean(yesterday && !hideYesterday)
  // First read of the day: the numbers are not in yet. Say so instead of
  // reporting an empty day, and keep a way to start regardless.
  const firstLoad = loading && !overview

  return (
    <section
      aria-label="开始概览"
      aria-busy={loading || undefined}
      className="flex flex-col overflow-hidden rounded-xl border border-stage-line bg-surface-stage-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_24px_60px_-24px_rgb(0_0_0/0.7)]"
    >
      <div
        className={cn(
          'grid divide-y divide-stage-line lg:divide-y-0',
          hasSideColumn ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:divide-x' : 'lg:grid-cols-1',
        )}
      >
      <div className="grid grid-cols-2 divide-x divide-stage-line max-[380px]:grid-cols-1 max-[380px]:divide-x-0 max-[380px]:divide-y">
        <Metric
          surface="stage"
          label="待复习"
          hint="宫殿 / 复习单元"
          value={formatPalaceUnit(duePalaces, dueUnits)}
          tone={dueUnits ? 'primary' : 'default'}
          className="gap-1.5 px-6 py-6 [&>span:first-child]:text-[40px] [&>span:first-child]:leading-none"
        />
        <Metric
          surface="stage"
          label="第一次学"
          value={formatPalaceUnit(newPalaces, newUnits)}
          tone={newUnits ? 'success' : 'default'}
          className="gap-1.5 px-6 py-6 [&>span:first-child]:text-[40px] [&>span:first-child]:leading-none"
        />
      </div>
      <div className="flex flex-col gap-4 px-5 py-4 empty:hidden">

      {milestoneDays.length > 0 ? (
        <div className="flex flex-col gap-2.5" aria-label="近期里程碑">
          {milestoneDays.map((group) => (
            <div key={group.date} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink-stage">
              <span className="inline-flex shrink-0 items-baseline gap-1 rounded-md border border-stage-line bg-surface-stage px-1.5 py-0.5 text-xs font-semibold tabular-nums text-stage-glow">
                {group.date.slice(5).replace('-', '/')}
                <span className="font-normal text-ink-stage-muted">
                  {group.days_left === 0 ? '今天' : `${group.days_left} 天后`}
                </span>
              </span>
              {group.items.map((item) => (
                <span key={item.id} className="min-w-0">
                  <span className="font-medium">{item.title}</span>
                  {item.category ? <span className="ml-1 text-xs text-ink-stage-muted">{item.category}</span> : null}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {yesterday && !hideYesterday ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ink-stage-muted">昨天的回顾</p>
          <p className="text-sm text-ink-stage">
            学了{' '}
            <span className="font-semibold tabular-nums">
              {formatPalaceUnit(yesterday.learned_palace_count, yesterday.learned_units)}
            </span>
          </p>
          {weakUnits.length > 0 ? (
            <ul className="flex flex-col divide-y divide-stage-line" aria-label="薄弱单元">
              {weakUnits.slice(0, 3).map((unit) => (
                <li key={unit.unit_id} className="flex items-baseline justify-between gap-3 py-1 text-xs">
                  <span className="min-w-0 truncate text-ink-stage">
                    {unit.name}
                    <span className="text-ink-stage-muted"> · {unit.palace_name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-rate-again">
                    忘记 {Math.round(unit.again_ratio * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      </div>
      </div>
      <div className="border-t border-stage-line p-3">
        {!firstLoad && hasWork ? (
          <p className="mb-2 text-center text-[11px] text-stage-muted">
            {counts?.remaining ? `本轮还剩 ${counts.remaining} 个单元` : '按今日到期顺序开始'}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="freestyle-start-button"
          onClick={onStart}
          disabled={startDisabled || (!firstLoad && !hasWork)}
          className={cn(startButtonClass, 'w-full')}
        >
          {firstLoad ? '直接开始学习' : hasWork ? '开始学习' : '暂无需要学习的内容'}
        </button>
      </div>
    </section>
  )
}
