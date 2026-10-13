import { cn } from '@/shared/lib/utils'

/**
 * Part ÷ whole as a 0–1 ratio for a share bar. Unknown or empty wholes read as 0, and the
 * result is clamped so a part that briefly exceeds its whole never overflows the track.
 */
export function shareRatio(part: number | null | undefined, whole: number | null | undefined): number {
  if (part == null || whole == null || whole <= 0) return 0
  return Math.min(1, Math.max(0, part / whole))
}

interface ShareBarProps {
  /** 0–1 share of the parent total. */
  ratio: number
  /** CSS colour for the filled part. Defaults to a neutral grey so the bar carries no status colour. */
  fill?: string
  className?: string
  /** Accessible name; the bar is decorative when omitted. */
  label?: string
}

const NEUTRAL_FILL = 'var(--color-muted-foreground)'

/** A thin track whose filled length is the share. Text stays above it; the track never blocks clicks. */
export function ShareBar({ ratio, fill = NEUTRAL_FILL, className, label }: ShareBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div
      role={label ? 'meter' : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? percent : undefined}
      aria-hidden={label ? undefined : true}
      className={cn('pointer-events-none h-1 w-full overflow-hidden rounded-full bg-muted/60', className)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${percent}%`, backgroundColor: fill }}
      />
    </div>
  )
}
