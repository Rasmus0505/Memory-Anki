export interface RequestOutcome {
  method: string
  path: string
  ok: boolean
  status: number | null
  message: string
  queuedRetry: boolean
  elapsedMs: number
  /** The `action` field of a JSON body, e.g. a round action such as `compress_completed`. */
  action?: string
}

type OutcomeListener = (outcome: RequestOutcome) => void

const listeners = new Set<OutcomeListener>()

export function toRecorderPath(url: string) {
  const withoutQuery = url.split('?')[0] || url
  try {
    const pathname = new URL(withoutQuery, 'http://local').pathname
    return pathname.replace(/^\/api\/v1/, '') || '/'
  } catch {
    return withoutQuery.replace(/^\/api\/v1/, '') || withoutQuery
  }
}

export function publishRequestOutcome(outcome: RequestOutcome) {
  const method = outcome.method.toUpperCase()
  if (outcome.ok && method === 'GET') return
  const safe: RequestOutcome = {
    ...outcome,
    method,
    path: toRecorderPath(outcome.path),
    message: outcome.message.replace(/\s+/g, ' ').trim().slice(0, 180),
    elapsedMs: Math.max(0, Math.round(outcome.elapsedMs)),
  }
  listeners.forEach((listener) => {
    try {
      listener(safe)
    } catch {
      // A diagnosis listener must not break the request the learner just made.
    }
  })
}

export function subscribeRequestOutcomes(listener: OutcomeListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function noteApiStep(input: {
  method: string
  url: string
  ok: boolean
  status: number | null
  message: string
  queuedRetry: boolean
  startedAt: number
  action?: string
}) {
  publishRequestOutcome({
    method: input.method,
    path: input.url,
    ok: input.ok,
    status: input.status,
    message: input.message,
    queuedRetry: input.queuedRetry,
    elapsedMs: Date.now() - input.startedAt,
    action: input.action,
  })
}

/**
 * The `action` name of a round action body (`…/rounds/{id}/actions`). Other
 * requests are not parsed, so large editor saves never pay for this.
 */
export function bodyActionName(url: string, body: unknown): string | undefined {
  if (typeof body !== 'string' || !/\/actions(?:\?|$)/.test(url)) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object') return undefined
    const action = (parsed as { action?: unknown }).action
    return typeof action === 'string' && action ? action : undefined
  } catch {
    return undefined
  }
}
