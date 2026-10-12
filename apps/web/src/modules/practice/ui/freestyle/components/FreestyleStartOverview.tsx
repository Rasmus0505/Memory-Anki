import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import { Metric } from '@/shared/components/ui/metric'

interface FreestyleStartOverviewProps {
  overview: FreestyleOverviewResponse | null
  loading?: boolean
  error?: boolean
  onStart: () => void
  onRetry?: () => void
  startDisabled?: boolean
}

const startButtonClass =
  'rounded-xl bg-stage-glow px-4 py-2.5 text-sm font-medium text-stage transition disabled:opacity-40'

export function FreestyleStartOverview({
  overview,
  loading = false,
  error = false,
  onStart,
  onRetry,
  startDisabled = false,
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
  const palaces = counts ? counts.palaces : null
  const units = counts ? counts.units : null
  const due = today ? today.due_count : null
  const fresh = counts ? counts.new : (today ? today.new_palace_count : null)
  const hasWork = (counts?.remaining ?? 0) > 0 || (due ?? 0) > 0 || (fresh ?? 0) > 0
  const weakUnits = yesterday?.weak_units ?? []

  return (
    <section
      aria-label="开始概览"
      aria-busy={loading || undefined}
      className="flex flex-col gap-5 rounded-2xl border border-stage-line bg-surface-stage-raised p-5"
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Metric surface="stage" label="宫殿" value={palaces} />
        <Metric surface="stage" label="单元" value={units} />
        <Metric surface="stage" label="待复习" value={due} tone={due ? 'warning' : 'default'} />
        <Metric surface="stage" label="第一次学" value={fresh} tone={fresh ? 'info' : 'default'} />
      </div>

      {yesterday ? (
        <div className="flex flex-col gap-2 border-t border-stage-line pt-4">
          <p className="text-xs font-medium text-ink-stage-muted">昨天的回顾</p>
          <p className="text-sm text-ink-stage">
            学了 <span className="font-semibold tabular-nums">{yesterday.learned_units}</span> 个单元，
            评分 <span className="font-semibold tabular-nums">{yesterday.rated_count}</span> 次
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

      <button
        type="button"
        onClick={onStart}
        disabled={startDisabled || loading || !hasWork}
        className={startButtonClass}
      >
        {hasWork ? '开始学习' : '暂无需要学习的内容'}
      </button>
    </section>
  )
}
