import { cn } from '@/shared/lib/utils'

/** Small signed mastery change near the percent (green ↑, red ↓). */
export function masteryDelta(current: number, previous?: number | null): number | null {
  if (previous == null || !Number.isFinite(previous) || !Number.isFinite(current)) return null
  return Math.round(current) - Math.round(previous)
}

export function formatMasteryDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export function MasteryDeltaBadge({
  current,
  previous,
  className,
}: {
  current: number
  previous?: number | null
  className?: string
}) {
  const delta = masteryDelta(current, previous)
  if (delta === null) {
    return (
      <span
        className={cn('ml-1.5 text-xs font-medium tabular-nums text-muted-foreground', className)}
        title="首次正式复习，暂无对比"
      >
        新
      </span>
    )
  }
  if (delta === 0) {
    return (
      <span
        className={cn('ml-1.5 text-xs font-semibold tabular-nums text-muted-foreground', className)}
        title="掌握度持平"
      >
        0
      </span>
    )
  }
  const rising = delta > 0
  return (
    <span
      className={cn(
        'ml-1.5 text-xs font-semibold tabular-nums',
        rising ? 'text-success' : 'text-destructive',
        className,
      )}
      title={rising ? `掌握度上升 ${delta}%` : `掌握度下降 ${Math.abs(delta)}%`}
    >
      {formatMasteryDelta(delta)}
    </span>
  )
}
