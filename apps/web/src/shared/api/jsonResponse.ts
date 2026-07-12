import { logAppError } from '@/shared/logs/model/appLogs'

export function getResponseRequestId(response: Response) {
  return response.headers.get('X-Request-ID') || ''
}

export interface RequestErrorContext {
  feature?: string
  method?: string
  url?: string
  status?: number
}

function formatRequestErrorMessage(message: string, requestId: string, context?: RequestErrorContext) {
  const details = [
    context?.feature ? `操作：${context.feature}` : null,
    context?.method || context?.url
      ? `请求：${context?.method?.toUpperCase() || 'HTTP'} ${context?.url || '未知接口'}`
      : null,
    context?.status != null ? `HTTP 状态：${context.status}` : null,
    requestId ? `请求 ID：${requestId}` : null,
  ].filter(Boolean)
  return details.length > 0 ? `${message}\n${details.join('\n')}` : message
}

export function buildRequestError(message: string, requestId: string, context?: RequestErrorContext) {
  const error = new Error(formatRequestErrorMessage(message, requestId, context)) as Error & {
    requestId?: string
    status?: number
    method?: string
    url?: string
  }
  error.requestId = requestId || undefined
  error.status = context?.status
  error.method = context?.method
  error.url = context?.url
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
    if (
      parsed.detail
      && typeof parsed.detail === 'object'
      && 'message' in parsed.detail
      && typeof parsed.detail.message === 'string'
      && parsed.detail.message.trim()
    ) {
      return parsed.detail.message
    }
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
    throw buildRequestError(message, requestId, {
      feature: options.feature,
      status: response.status,
    })
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
    throw buildRequestError(message, requestId, {
      feature: options.feature,
      status: response.status,
    })
  }
}
