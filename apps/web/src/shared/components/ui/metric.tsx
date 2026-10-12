import { cn } from '@/shared/lib/utils'

export type MetricTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
export type MetricSurface = 'page' | 'stage'

const pageValueTone: Record<MetricTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary-strong',
  success: 'text-success-strong',
  warning: 'text-warning-strong',
  danger: 'text-danger-strong',
  info: 'text-info-strong',
}

// On the charcoal stage the same semantic tones lift to the stage ink, so text stays legible without a light card behind it.
const stageValueTone: Record<MetricTone, string> = {
  default: 'text-ink-stage',
  primary: 'text-stage-glow',
  success: 'text-memory-strong',
  warning: 'text-memory-medium',
  danger: 'text-memory-weak',
  info: 'text-memory-new',
}

interface MetricProps {
  label: string
  value: number | string | null
  hint?: string
  tone?: MetricTone
  surface?: MetricSurface
  className?: string
}

/** One labelled figure: a tabular number above its caption. Shared by every summary surface. */
export function Metric({ label, value, hint, tone = 'default', surface = 'page', className }: MetricProps) {
  const stage = surface === 'stage'
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span
        className={cn(
          'text-2xl font-semibold tabular-nums leading-none',
          stage ? stageValueTone[tone] : pageValueTone[tone],
        )}
      >
        {value == null ? '—' : value}
      </span>
      <span className={cn('truncate text-xs', stage ? 'text-ink-stage-muted' : 'text-ink-muted')}>{label}</span>
      {hint ? <span className={cn('truncate text-[11px]', stage ? 'text-ink-stage-muted' : 'text-ink-faint')}>{hint}</span> : null}
    </div>
  )
}
