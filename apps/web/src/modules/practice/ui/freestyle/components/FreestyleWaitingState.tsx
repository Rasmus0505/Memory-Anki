import { Clock3, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { parseApiDateTime } from '@/shared/lib/dateTime'
import { remainingLabel } from '@/modules/practice/ui/freestyle/model/freestyleWaitCopy'

export type FreestyleWaitingStateProps = {
  count: number
  readyAt: string | null
  onRefresh: () => void
}

/** Local wall-clock label for the server's UTC instant. */
export function readyLabel(iso: string | null): string {
  if (!iso) return ''
  const at = parseApiDateTime(iso)
  const ms = at.getTime()
  if (!Number.isFinite(ms)) return '稍后'
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

/**
 * The server will not publish a waiting card before `readyAt`, so a refresh
 * pressed earlier can only return the same wait. Track the instant locally and
 * keep the control inert until then, showing how long is left instead.
 *
 * `readyAt == null` means no time is committed: never block the press.
 */
export function useWaitingDue(readyAt: string | null): { due: boolean; remaining: string } {
  const target = parseApiDateTime(readyAt).getTime()
  const [now, setNow] = useState(() => Date.now())
  const due = !Number.isFinite(target) || now >= target
  useEffect(() => {
    if (!Number.isFinite(target)) return
    const tick = () => setNow(Date.now())
    tick()
    if (Date.now() >= target) return
    const handle = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= target) window.clearInterval(handle)
    }, 5_000)
    return () => window.clearInterval(handle)
  }, [target])
  return { due, remaining: due ? '' : remainingLabel(target - now) }
}

/**
 * Shown when everything servable is done but same-day steps/retries are still
 * waiting. Without this the feed would claim the round is finished and hide the
 * work the learner still owes today.
 */
export function FreestyleWaitingState({ count, readyAt, onRefresh }: FreestyleWaitingStateProps) {
  const time = readyAt ? readyLabel(readyAt) : ''
  const { due, remaining } = useWaitingDue(readyAt)
  return (
    <div
      data-testid="freestyle-waiting-state"
      role="status"
      className="mx-auto mt-8 w-full max-w-md rounded-2xl border border-border bg-card/80 p-6 text-center"
    >
      <Clock3 className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-3 text-sm font-medium">还有 {count} 张要稍后再看</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {time ? `最早 ${time} ${due ? '已到点' : '到点'}；` : ''}
        到点会自动回到队列{due ? '，也可以现在刷新。' : '，先不用手动刷新。'}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onRefresh}
        disabled={!due}
        title={!due && time ? `${time} 后才会放回队列` : undefined}
      >
        <RefreshCw className="mr-1 size-4" aria-hidden />
        {due ? '现在刷新' : time ? `${time} 后可刷新` : '现在刷新'}
      </Button>
      {!due ? (
        <p className="mt-2 text-xs tabular-nums text-muted-foreground" aria-hidden>
          {remaining}
        </p>
      ) : null}
    </div>
  )
}
