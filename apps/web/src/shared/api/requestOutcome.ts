const SAFE_BODY_ACTIONS = new Set([
  'compress_completed',
  'exclude',
  'restore',
  'complete',
  'uncomplete',
  'skip',
  'bind_cards',
  'set_encounter',
  'set_cursor',
  'leave_card',
])

export interface RequestOutcome {
  method: string
  /** A route template with dynamic ids removed, never the original URL. */
  path: string
  ok: boolean
  status: number | null
  /** A closed failure category, never a server response or request body. */
  message: string
  queuedRetry: boolean
  elapsedMs: number
  /** An allowlisted action from a round action body. */
  action?: string
}

type OutcomeListener = (outcome: RequestOutcome) => void

const listeners = new Set<OutcomeListener>()

const DYNAMIC_PARENT_SEGMENTS = new Set([
  'rounds', 'palaces', 'subjects', 'units', 'sessions', 'courses', 'study-sessions',
  'ratings', 'question-attempts', 'question-explanations', 'review',
])

function routeTemplate(pathname: string) {
  const segments = pathname.replace(/^\/api\/v1/, '').split('/').filter(Boolean)
  const normalized: string[] = []
  for (const segment of segments) {
    const previous = normalized.at(-1)
    const looksLikeId = previous && DYNAMIC_PARENT_SEGMENTS.has(previous)
    normalized.push(looksLikeId || /^[0-9a-f]{8,}$/i.test(segment) ? ':id' : segment)
  }
  const joined = normalized.join('/')
  return joined ? `/${joined}` : '/'
}

function failureCategory(message: string, status: number | null) {
  const text = message.toLowerCase()
  if (status === 409 || text.includes('冲突') || text.includes('conflict')) return 'conflict'
  if (status === 401 || status === 403) return 'permission'
  if (status === 404) return 'not_found'
  if (text.includes('timeout') || text.includes('超时') || text.includes('abort')) return 'timeout'
  if (text.includes('network') || text.includes('failed to fetch') || text.includes('连接')) return 'network'
  if (status != null && status >= 500) return 'server_error'
  if (status === 400 || status === 422) return 'invalid_request'
  return status == null ? 'no_response' : 'request_failed'
}

export function toRecorderPath(url: string) {
  try {
    return routeTemplate(new URL(url, 'http://local').pathname)
  } catch {
    return '/other'
  }
}

export function publishRequestOutcome(outcome: RequestOutcome) {
  const method = outcome.method.toUpperCase()
  if (outcome.ok && method === 'GET') return
  const safe: RequestOutcome = {
    method,
    path: toRecorderPath(outcome.path),
    ok: outcome.ok,
    status: outcome.status,
    message: outcome.ok ? '' : failureCategory(outcome.message, outcome.status),
    queuedRetry: Boolean(outcome.queuedRetry),
    elapsedMs: Math.max(0, Math.round(outcome.elapsedMs)),
    action: outcome.action && SAFE_BODY_ACTIONS.has(outcome.action) ? outcome.action : undefined,
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
    return typeof action === 'string' && SAFE_BODY_ACTIONS.has(action) ? action : undefined
  } catch {
    return undefined
  }
}
