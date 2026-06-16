import { parseSseEventBlock } from '@/shared/api/sse'
import type { ImportStreamDeltaEvent, ImportStreamStatusEvent } from '@/shared/api/contracts'
import { logAppError } from '@/shared/logs/model/appLogs'

export interface ImportStreamHandlers {
  onStatus?: (event: ImportStreamStatusEvent) => void
  onDelta?: (event: ImportStreamDeltaEvent) => void
}

function getResponseRequestId(response: Response) {
  return response.headers.get('X-Request-ID') || ''
}

function buildRequestError(message: string, requestId: string) {
  const error = new Error(message) as Error & { requestId?: string }
  error.requestId = requestId || undefined
  return error
}

function attachRequestId<T>(payload: T, requestId: string): T {
  if (!requestId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload
  }
  return {
    ...(payload as Record<string, unknown>),
    request_id: requestId,
  } as T
}

function extractImportApiMessage(status: number, body: string): string {
  const normalized = body.trim()
  if (!normalized) {
    return `HTTP ${status}`
  }
  try {
    const parsed = JSON.parse(normalized) as { detail?: unknown; error?: unknown; message?: unknown }
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message
  } catch {
    // Fall through to plain-text handling below.
  }
  if (/^\s*</.test(normalized) || /internal server error/i.test(normalized)) {
    return '服务端暂时返回了非 JSON 错误页，请稍后继续识别。'
  }
  return normalized
}

export async function readImportJson<T>(response: Response): Promise<T> {
  const body = await response.text().catch(() => '')
  const requestId = getResponseRequestId(response)
  if (!response.ok) {
    const message = extractImportApiMessage(response.status, body)
    logAppError({
      feature: '导入接口',
      stage: 'http_error',
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
    const message = extractImportApiMessage(response.status, body)
    logAppError({
      feature: '导入接口',
      stage: 'json_parse_error',
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

export async function parseImportStreamResponse<T extends { ok: boolean; error?: string }>(
  response: Response,
  handlers?: ImportStreamHandlers,
): Promise<T> {
  const requestId = getResponseRequestId(response)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const message = extractImportApiMessage(response.status, body)
    logAppError({
      feature: '导入流式接口',
      stage: 'http_error',
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

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    return readImportJson<T>(response)
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式响应读取。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: T | null = null
  let finalError = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const parsedEvent = parseSseEventBlock(part)
      if (!parsedEvent) continue
      let payload: any
      try {
        payload = JSON.parse(parsedEvent.data)
      } catch (error) {
        logAppError({
          feature: '导入流式接口',
          stage: 'sse_json_parse_error',
          error,
          responseSummary: parsedEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: parsedEvent.event,
            requestId,
          },
        })
        throw buildRequestError('模型返回的流式数据格式异常。', requestId)
      }
      if (parsedEvent.event === 'status') {
        handlers?.onStatus?.(payload as ImportStreamStatusEvent)
        continue
      }
      if (parsedEvent.event === 'delta') {
        handlers?.onDelta?.(payload as ImportStreamDeltaEvent)
        continue
      }
      if (parsedEvent.event === 'result') {
        finalResult = payload as T
        continue
      }
      if (parsedEvent.event === 'error') {
        finalError = typeof payload?.error === 'string' ? payload.error : '识别失败，请稍后重试。'
        logAppError({
          feature: '导入流式接口',
          stage: 'sse_error_event',
          error: finalError,
          responseSummary: parsedEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: parsedEvent.event,
            requestId,
          },
        })
      }
    }

    if (done) break
  }

  if (finalResult) {
    return attachRequestId(finalResult, requestId)
  }
  if (finalError) {
    return attachRequestId({ ok: false, error: finalError } as T, requestId)
  }
  throw buildRequestError('流式响应未返回最终结果。', requestId)
}
