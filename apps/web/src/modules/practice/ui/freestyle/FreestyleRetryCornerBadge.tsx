import type { FreestyleCard } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { retryChromeClass } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'

export function FreestyleRetryCornerBadge({
  card,
  retryAfterCards,
  completed,
}: {
  card: FreestyleCard
  retryAfterCards?: number
  completed: boolean
}) {
  const isRetry = card.occurrence_kind === 'retry'
  const isSourceRetry = !isRetry && retryAfterCards != null
  if (!isRetry && !isSourceRetry) return null
  const done = isRetry && completed
  const label = isRetry
    ? (done
      ? `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次 · 已过`
      : `重练第 ${Math.max(1, card.retry_attempt ?? 1)} 次`)
    : `${Math.max(0, retryAfterCards ?? 3)} 张后重练`
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
