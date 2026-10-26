import { useEffect, useState } from 'react'
import { parseApiDateTime } from '@/shared/lib/dateTime'

/**
 * Copy for a server-booked wait.
 *
 * Same-day steps/retries are withheld until `available_at`: 10 minutes, then
 * 1 hour, then 3 hours for 忘记/困难, 30 minutes for a first-pass re-check. The
 * API may still hand back naive (offset-less) UTC strings, so every reader goes
 * through `parseApiDateTime`; parsing them as local wall time used to shift the
 * countdown by the UTC offset.
 */
export function remainingLabel(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes <= 0) return '马上到点'
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟后` : `${hours} 小时后`
}

/** Source-card badge copy: when the retry will come back. */
export function retryWaitLabel(iso: string | null | undefined, now = Date.now()): string {
  const target = parseApiDateTime(iso).getTime()
  if (!Number.isFinite(target)) return '稍后重练'
  if (target <= now) return '重练已到点'
  return `${remainingLabel(target - now)}重练`
}

/**
 * A display-only clock. Ticks only while the instant is still ahead, so a
 * badge left on screen does not wake up every 15 seconds all round.
 */
export function useWaitCountdown(iso: string | null | undefined): { due: boolean; label: string } {
  const target = parseApiDateTime(iso).getTime()
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
    }, 15_000)
    return () => window.clearInterval(handle)
  }, [target])
  return { due, label: retryWaitLabel(iso, now) }
}
