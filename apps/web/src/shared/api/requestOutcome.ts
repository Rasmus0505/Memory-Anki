export interface RequestOutcome {
  method: string
  path: string
  ok: boolean
  status: number | null
  message: string
  queuedRetry: boolean
  elapsedMs: number
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
}) {
  publishRequestOutcome({
    method: input.method,
    path: input.url,
    ok: input.ok,
    status: input.status,
    message: input.message,
    queuedRetry: input.queuedRetry,
    elapsedMs: Date.now() - input.startedAt,
  })
}
