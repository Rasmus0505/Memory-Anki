import { Clock3 } from 'lucide-react'
import { readyLabel } from './FreestyleWaitingState'

export type FreestyleWaitingBannerProps = {
  count: number
  readyAt: string | null
  onRefresh: () => void
}

/**
 * A slim reminder while cards are still on screen: some of today's work is
 * booked for later. It disappears when the wait has been served.
 */
export function FreestyleWaitingBanner({ count, readyAt, onRefresh }: FreestyleWaitingBannerProps) {
  const time = readyAt ? readyLabel(readyAt) : ''
  return (
    <div
      role="status"
      data-testid="freestyle-waiting-banner"
      className="mx-auto mt-2 flex w-full max-w-xl items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
    >
      <Clock3 className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        还有 {count} 张稍后{time ? ` · 最早 ${time} 到点` : ''}
      </span>
      <button
        type="button"
        className="shrink-0 underline underline-offset-4 hover:text-foreground"
        onClick={onRefresh}
      >
        现在刷新
      </button>
    </div>
  )
}
