import type { FreestyleCard } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { retryChromeClass } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { useWaitCountdown } from '@/modules/practice/ui/freestyle/model/freestyleWaitCopy'

export function FreestyleRetryCornerBadge({
  card,
  retryScheduled,
  retryAvailableAt,
  completed,
}: {
  card: FreestyleCard
  /** The source's 忘记/困难 booked a retry that has not been answered yet. */
  retryScheduled?: boolean
  /** Server instant the retry comes back; null/undefined while unknown. */
  retryAvailableAt?: string | null
  completed: boolean
}) {
  const isRetry = card.occurrence_kind === 'retry'
  // Hooks stay unconditional; a retry card itself has no wait to count.
  const { label: waitLabel } = useWaitCountdown(isRetry ? null : retryAvailableAt)
  if (!isRetry && !retryScheduled) return null
  const done = isRetry && completed
  const label = isRetry
    ? (done
      ? `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次 · 已过`
      : `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次`)
    // Never promise a card offset: the retry waits for its server instant.
    : waitLabel
  return (
    <div
      data-testid="freestyle-retry-corner-badge"
      data-completed={done ? 'true' : 'false'}
      role="status"
      // Left, under the title chip: the mobile nav dock this used to dodge is gone,
      // the bottom edge belongs to the rating bar, and the top-right holds the
      // overflow.
      className={cn(
        'pointer-events-none absolute left-4 top-[calc(3.25rem+env(safe-area-inset-top,0px))] z-30 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-lg sm:top-14',
        retryChromeClass(done),
      )}
    >
      <span aria-hidden>{isRetry ? '↻' : '·'}</span>
      {label}
    </div>
  )
}
