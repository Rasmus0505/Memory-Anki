import { Clock3, RefreshCw } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'

export type FreestyleWaitingStateProps = {
  count: number
  readyAt: string | null
  onRefresh: () => void
}

/** Local wall-clock label for the server's UTC instant. */
export function readyLabel(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '稍后'
  const at = new Date(ms)
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

/**
 * Shown when everything servable is done but same-day steps/retries are still
 * waiting. Without this the feed would claim the round is finished and hide the
 * work the learner still owes today.
 */
export function FreestyleWaitingState({ count, readyAt, onRefresh }: FreestyleWaitingStateProps) {
  return (
    <div
      data-testid="freestyle-waiting-state"
      role="status"
      className="mx-auto mt-8 w-full max-w-md rounded-2xl border border-border bg-card/80 p-6 text-center"
    >
      <Clock3 className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-medium">还有 {count} 张要稍后再看</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {readyAt ? `最早 ${readyLabel(readyAt)} 到点；` : ''}
        到点会自动回到队列，也可以现在刷新。
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRefresh}>
        <RefreshCw className="mr-1 size-4" aria-hidden />
        现在刷新
      </Button>
    </div>
  )
}
