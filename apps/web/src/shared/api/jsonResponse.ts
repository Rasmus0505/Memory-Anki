import { logAppError } from '@/shared/logs/model/appLogs'

export function getResponseRequestId(response: Response) {
  return response.headers.get('X-Request-ID') || ''
}

export function buildRequestError(message: string, requestId: string) {
  const error = new Error(message) as Error & { requestId?: string }
  error.requestId = requestId || undefined
  return error
}

export function attachRequestId<T>(payload: T, requestId: string): T {
  if (!requestId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }
  return {
    ...(payload as Record<string, unknown>),
    request_id: requestId,
  } as T
}

export function extractResponseMessage(
  status: number,
  body: string,
  fallbackMessage = `HTTP ${status}`,
  nonJsonErrorMessage = fallbackMessage,
) {
  const normalized = body.trim()
  if (!normalized) {
    return fallbackMessage
  }
  try {
    const parsed = JSON.parse(normalized) as {
      detail?: unknown
      error?: unknown
      message?: unknown
    }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message
  } catch {
    // Fall through to plain-text handling below.
  }
  if (/^\s*</.test(normalized) || /internal server error/i.test(normalized)) {
    return nonJsonErrorMessage
  }
  return normalized
}

export interface ReadJsonResponseOptions {
  feature: string
  httpStage?: string
  parseStage?: string
  nonJsonErrorMessage?: string
}

export async function readJsonResponse<T>(
  response: Response,
  options: ReadJsonResponseOptions,
): Promise<T> {
  const body = await response.text().catch(() => '')
  const requestId = getResponseRequestId(response)
  const httpStage = options.httpStage || 'http_error'
  const parseStage = options.parseStage || 'json_parse_error'
  const nonJsonErrorMessage = options.nonJsonErrorMessage || `HTTP ${response.status}`

  if (!response.ok) {
    const message = extractResponseMessage(
      response.status,
      body,
      `HTTP ${response.status}`,
      nonJsonErrorMessage,
    )
    logAppError({
      feature: options.feature,
      stage: httpStage,
      error: message,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }

  try {
    return attachRequestId(JSON.parse(body) as T, requestId)
  } catch (error) {
    const message = extractResponseMessage(
      response.status,
      body,
      `HTTP ${response.status}`,
      nonJsonErrorMessage,
    )
    logAppError({
      feature: options.feature,
      stage: parseStage,
      error,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }
}
