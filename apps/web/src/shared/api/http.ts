import { logAppError } from '@/shared/logs/model/appLogs'

export const API_BASE = '/api/v1'

function extractApiErrorMessage(status: number, body: string) {
  const normalized = body.trim()
  if (!normalized) {
    return `HTTP ${status}`
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
    // Fall back to the raw response body below.
  }
  return normalized
}

function getRequestId(response: Response) {
  return response.headers.get('X-Request-ID') || ''
}

function buildRequestError(message: string, requestId: string) {
  const error = new Error(message) as Error & { requestId?: string }
  error.requestId = requestId || undefined
  return error
}

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const requestUrl = `${API_BASE}${url}`
  const method = options?.method || 'GET'
  let response: Response

  try {
    response = await fetch(requestUrl, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    })
  } catch (error) {
    logAppError({
      feature: 'API 请求',
      stage: 'network_failure',
      error,
      requestSummary: `${method} ${requestUrl}`,
      meta: {
        method,
        url: requestUrl,
      },
    })
    throw error
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const message = extractApiErrorMessage(response.status, body)
    const requestId = getRequestId(response)
    console.error('[API ERROR]', {
      url: requestUrl,
      method,
      status: response.status,
      body,
    })
    logAppError({
      feature: 'API 请求',
      stage: 'http_error',
      error: message,
      requestSummary: `${method} ${requestUrl}`,
      responseSummary: body.slice(0, 1200),
      requestId,
      meta: {
        method,
        url: requestUrl,
        status: response.status,
        requestId,
      },
    })
    throw buildRequestError(message, requestId)
  }

  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    try {
      return await response.json()
    } catch (error) {
      const requestId = getRequestId(response)
      logAppError({
        feature: 'API 请求',
        stage: 'json_parse_error',
        error,
        requestSummary: `${method} ${requestUrl}`,
        requestId,
        meta: {
          method,
          url: requestUrl,
          contentType,
          requestId,
        },
      })
      throw buildRequestError(
        error instanceof Error ? error.message || 'JSON 解析失败' : 'JSON 解析失败',
        requestId,
      )
    }
  }
  return response.text() as unknown as T
}
