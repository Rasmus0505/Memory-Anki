import { Clock3, RefreshCw } from 'lucide-react'
import { readyLabel, useWaitingDue } from './FreestyleWaitingState'

export type FreestyleWaitingBannerProps = {
  count: number
  readyAt: string | null
  onRefresh: () => void
}

/**
 * A slim reminder while cards are still on screen: some of today's work is
 * booked for later. It disappears when the wait has been served.
 *
 * Before the ready instant the server cannot release the cards, so the banner
 * shows a countdown instead of a button that would do nothing.
 */
export function FreestyleWaitingBanner({ count, readyAt, onRefresh }: FreestyleWaitingBannerProps) {
  const time = readyAt ? readyLabel(readyAt) : ''
  const { due, remaining } = useWaitingDue(readyAt)
  const summary = !time
    ? `还有 ${count} 张稍后`
    : due
      ? `还有 ${count} 张稍后 · 已到点`
      : `还有 ${count} 张稍后 · ${time} 到点`
  return (
    <div
      role="status"
      data-testid="freestyle-waiting-banner"
      className="mx-auto mt-2 flex w-full max-w-xl items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
    >
      <Clock3 className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{summary}</span>
      {due ? (
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 underline underline-offset-4 hover:text-foreground"
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          现在刷新
        </button>
      ) : (
        <span className="shrink-0 tabular-nums text-muted-foreground/80" aria-hidden>
          {remaining}
        </span>
      )}
    </div>
  )
}
