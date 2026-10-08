/**
 * Bounded retry for a *busy* server (HTTP 503), used by writes that deliberately
 * stay out of the mutation queue.
 *
 * Why this exists
 * ---------------
 * The app has two serialization layers, and both answer 503 with `Retry-After`
 * when they are contended: the app-level runtime storage lock and SQLite's own
 * write lock. `mutationQueue` already honours that signal — but only for writes
 * that are *queued*. The freestyle session-start POST opts out of the queue on
 * purpose (`persistence: false`, because a stale replay would reopen an
 * encounter the learner has already moved past), so it inherited none of the
 * retry behaviour. Its comment claimed it "fails fast into its own retry path",
 * but that path is a manual button.
 *
 * The result, measured 2026-10-07: this endpoint produced
 * `database is locked` -> 500 / `storage busy` -> 503 repeatedly, and every one
 * of them ended at the same dead banner with a 重试 button. Retrying by hand
 * re-enters the same contention, so the card looked permanently broken.
 *
 * The fix keeps the decision in the UI's hands (it still owns the encounter
 * lifecycle) while removing the "user must click to make progress" step: back
 * off, retry a bounded number of times, then surface the failure honestly.
 *
 * The same `X-Request-ID` is reused across attempts so all of them collapse into
 * one traceable story in the server log instead of N unrelated requests.
 */
import { generateLocalId } from '@/shared/lib/ids'

export const BUSY_STATUS = 503

/** Delays between attempts. Total worst case is a few seconds, not a stall. */
const DEFAULT_BUSY_DELAYS_MS = [300, 900, 2_000]

export interface BusyRetryOptions {
  /** Override the backoff schedule (one entry per retry). */
  delaysMs?: number[]
  /** Called before each retry, for progress copy. */
  onRetry?: (attempt: number) => void
  /** Correlation id to reuse; one is generated when omitted. */
  requestId?: string
}

/** True when the error is the server's retryable "busy, try again" answer. */
export function isBusyResponseError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status
  return status === BUSY_STATUS
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * Run `attempt`, retrying only while the server reports itself busy.
 *
 * Any non-503 failure propagates immediately: retrying a 400/409/500 would be
 * either pointless or actively wrong (a conflict must reach the UI so it can
 * repair state). `Retry-After` is deliberately ignored here in favour of a short
 * local schedule — the server's hint is sized for a background queue, and this
 * call sits in front of a learner waiting for a card.
 */
export async function retryWhileBusy<T>(
  attempt: (headers: Record<string, string>) => Promise<T>,
  options: BusyRetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_BUSY_DELAYS_MS
  const requestId = options.requestId ?? generateLocalId()
  let lastError: unknown

  for (let index = 0; index <= delays.length; index += 1) {
    try {
      return await attempt({ 'X-Request-ID': requestId })
    } catch (error) {
      lastError = error
      if (!isBusyResponseError(error) || index === delays.length) throw error
      options.onRetry?.(index + 1)
      await sleep(delays[index])
    }
  }
  throw lastError
}
