import { logAppError } from '@/shared/logs/model/appLogs'
import { parseSseEventBlock } from '@/shared/api/sse'
import {
  attachRequestId,
  buildRequestError,
  getResponseRequestId,
  readJsonResponse,
  type ReadJsonResponseOptions,
} from '@/shared/api/jsonResponse'

interface ReadSseResultResponseOptions<T, TStatus = unknown, TDelta = unknown> {
  feature: string
  handlers?: {
    onStatus?: (event: TStatus) => void
    onDelta?: (event: TDelta) => void
  }
  jsonOptions?: Omit<ReadJsonResponseOptions, 'feature'>
  statusGuard?: (payload: unknown) => payload is TStatus
  selectResult?: (payload: unknown) => T | null
  selectErrorMessage?: (payload: unknown) => string | null
  makeErrorResult?: (message: string) => T
  unsupportedStreamMessage?: string
  parseErrorMessage?: string
  missingResultMessage?: string
}

function getPayloadMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  for (const key of ['detail', 'error', 'message']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export async function readSseResultResponse<T, TStatus = unknown, TDelta = unknown>(
  response: Response,
  options: ReadSseResultResponseOptions<T, TStatus, TDelta>,
): Promise<T> {
  const requestId = getResponseRequestId(response)
  if (!response.ok) {
    return readJsonResponse<T>(response, { feature: options.feature, ...options.jsonOptions })
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    return readJsonResponse<T>(response, { feature: options.feature, ...options.jsonOptions })
  }

  if (!response.body) {
    throw buildRequestError(
      options.unsupportedStreamMessage || 'Browser cannot read streaming responses.',
      requestId,
    )
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

      let payload: unknown
      try {
        payload = JSON.parse(parsedEvent.data)
      } catch (error) {
        logAppError({
          feature: options.feature,
          stage: 'sse_json_parse_error',
          error,
          responseSummary: parsedEvent.data.slice(0, 1200),
          requestId,
          meta: {
            event: parsedEvent.event,
            requestId,
          },
        })
        throw buildRequestError(
          options.parseErrorMessage || 'Streaming response data was malformed.',
          requestId,
        )
      }

      if (parsedEvent.event === 'status') {
        if (!options.statusGuard || options.statusGuard(payload)) {
          options.handlers?.onStatus?.(payload as TStatus)
        }
        continue
      }
      if (parsedEvent.event === 'delta') {
        options.handlers?.onDelta?.(payload as TDelta)
        continue
      }
      if (parsedEvent.event === 'result') {
        finalResult = options.selectResult
          ? options.selectResult(payload)
          : (payload as T)
        continue
      }
      if (parsedEvent.event === 'error') {
        finalError =
          options.selectErrorMessage?.(payload)
          || getPayloadMessage(payload)
          || 'Streaming request failed.'
        logAppError({
          feature: options.feature,
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

  if (finalResult) return attachRequestId(finalResult, requestId)
  if (finalError) {
    if (options.makeErrorResult) {
      return attachRequestId(options.makeErrorResult(finalError), requestId)
    }
    throw buildRequestError(finalError, requestId)
  }
  throw buildRequestError(options.missingResultMessage || 'Streaming response did not return a result.', requestId)
}
