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
  'ma-pressable inline-flex h-11 items-center justify-center rounded-xl bg-stage-glow px-5 text-sm font-semibold text-stage shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_24px_-8px_color-mix(in_oklab,var(--color-stage-glow)_70%,transparent)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stage-glow/60 focus-visible:ring-offset-2 focus-visible:ring-offset-stage disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none'

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

  return (
    <section
      aria-label="开始概览"
      aria-busy={loading || undefined}
      className="flex flex-col overflow-hidden rounded-2xl border border-stage-line bg-surface-stage-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_24px_60px_-24px_rgb(0_0_0/0.7)]"
    >
      <div className="grid grid-cols-2 divide-x divide-stage-line">
        <Metric
          surface="stage"
          label="待复习"
          hint="宫殿 / 复习单元"
          value={formatPalaceUnit(duePalaces, dueUnits)}
          tone={dueUnits ? 'warning' : 'default'}
          className="gap-1.5 px-5 py-5 [&>span:first-child]:text-3xl"
        />
        <Metric
          surface="stage"
          label="第一次学"
          hint="宫殿 / 复习单元"
          value={formatPalaceUnit(newPalaces, newUnits)}
          tone={newUnits ? 'info' : 'default'}
          className="gap-1.5 px-5 py-5 [&>span:first-child]:text-3xl"
        />
      </div>
      <div className="flex flex-col gap-4 border-t border-stage-line px-5 py-4 empty:hidden">

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
            <ul className="flex flex-wrap gap-2" aria-label="薄弱单元">
              {weakUnits.slice(0, 3).map((unit) => (
                <li
                  key={unit.unit_id}
                  className="rounded-full bg-surface-stage px-3 py-1 text-xs text-memory-weak"
                >
                  {unit.name}
                  <span className="text-ink-stage-muted"> · {unit.palace_name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      </div>
      <div className="border-t border-stage-line p-3">
        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled || loading || !hasWork}
          className={cn(startButtonClass, 'w-full')}
        >
          {hasWork ? '开始学习' : '暂无需要学习的内容'}
        </button>
      </div>
    </section>
  )
}
