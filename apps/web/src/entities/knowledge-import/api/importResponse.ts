import { parseSseEventBlock } from '@/shared/api/sse'
import type { ImportStreamDeltaEvent, ImportStreamStatusEvent } from '@/shared/api/contracts'
import {
  attachRequestId,
  buildRequestError,
  getResponseRequestId,
  readJsonResponse,
} from '@/shared/api/jsonResponse'
import { logAppError } from '@/shared/logs/model/appLogs'

export interface ImportStreamHandlers {
  onStatus?: (event: ImportStreamStatusEvent) => void
  onDelta?: (event: ImportStreamDeltaEvent) => void
}

export async function readImportJson<T>(response: Response): Promise<T> {
  return readJsonResponse<T>(response, {
    feature: '导入接口',
    nonJsonErrorMessage: '服务端暂时返回了非 JSON 错误页，请稍后继续识别。',
  })
}

export async function parseImportStreamResponse<T extends { ok: boolean; error?: string }>(
  response: Response,
  handlers?: ImportStreamHandlers,
): Promise<T> {
  const requestId = getResponseRequestId(response)
  if (!response.ok) {
    return readJsonResponse<T>(response, {
      feature: '导入流式接口',
      nonJsonErrorMessage: '服务端暂时返回了非 JSON 错误页，请稍后继续识别。',
    })
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    return readJsonResponse<T>(response, {
      feature: '导入流式接口',
      nonJsonErrorMessage: '服务端暂时返回了非 JSON 错误页，请稍后继续识别。',
    })
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
