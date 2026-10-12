import type { FreestyleOverviewResponse } from '@/shared/api/contracts'

interface FreestyleStartOverviewProps {
  overview: FreestyleOverviewResponse | null
  loading?: boolean
  error?: boolean
  onStart: () => void
  onRetry?: () => void
  startDisabled?: boolean
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl font-semibold tabular-nums text-stage-ink">
        {value == null ? '—' : value}
      </span>
      <span className="text-xs text-stage-muted">{label}</span>
    </div>
  )
}

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
      <section className="flex flex-col gap-4 rounded-2xl border border-stage-line bg-stage-raised p-5 text-stage-ink">
        <p className="text-sm text-stage-muted">概览暂时读取失败，仍可直接开始学习。</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={startDisabled}
            className="rounded-xl bg-stage-glow px-4 py-2.5 text-sm font-medium text-stage transition disabled:opacity-40"
          >
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
  const counts = round?.counts ?? null
  const palaces = counts ? counts.palaces : null
  const units = counts ? counts.units : null
  const due = today ? today.due_count : null
  const fresh = counts ? counts.new : (today ? today.new_palace_count : null)
  const hasWork = (counts?.remaining ?? 0) > 0 || (due ?? 0) > 0 || (fresh ?? 0) > 0

  return (
    <section
      aria-label="开始概览"
      aria-busy={loading || undefined}
      className="flex flex-col gap-5 rounded-2xl border border-stage-line bg-stage-raised p-5"
    >
      <div className="grid grid-cols-4 gap-3">
        <Stat label="宫殿" value={palaces} />
        <Stat label="单元" value={units} />
        <Stat label="待复习" value={due} />
        <Stat label="新学" value={fresh} />
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={startDisabled || loading || !hasWork}
        className="rounded-xl bg-stage-glow px-4 py-2.5 text-sm font-medium text-stage transition disabled:opacity-40"
      >
        {hasWork ? '开始学习' : '暂无需要学习的内容'}
      </button>
    </section>
  )
}
