import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewImageTextApi, previewMindMapImportApi } from '@/modules/produce/domain/knowledge-import-entity/api'
import * as appLogs from '@/shared/logs/model/appLogs'

function createStreamResponse(chunks: string[], contentType = 'text/event-stream') {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': contentType },
  })
}

describe('import api stream parsing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses split SSE chunks and returns the final result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createStreamResponse([
          'event: status\n',
          'data: {"phase":"calling_model","message":"正在识别图片结构","step":2,"total_steps":4}\n\n',
          'event: delta\n',
          'data: {"text":"{\\"title\\":\\"导入脑图\\"","accumulated_text":"{\\"title\\":\\"导入脑图\\"","channel":"raw_model"}\n\n',
          'event: result\n',
          'data: {"ok":true,"source_tree":{"title":"导入脑图","children":[]},"editor_doc":{"root":{"data":{"text":"导入脑图","uid":"root"},"children":[]}}}\n\n',
        ]),
      ),
    )

    const onStatus = vi.fn()
    const onDelta = vi.fn()
    const result = await previewMindMapImportApi(new File(['x'], 'demo.png', { type: 'image/png' }), {
      onStatus,
      onDelta,
    })

    expect(onStatus).toHaveBeenCalledWith({
      phase: 'calling_model',
      message: '正在识别图片结构',
      step: 2,
      total_steps: 4,
    })
    expect(onDelta).toHaveBeenCalledWith({
      text: '{"title":"导入脑图"',
      accumulated_text: '{"title":"导入脑图"',
      channel: 'raw_model',
    })
    expect(result.ok).toBe(true)
    expect(result.source_tree?.title).toBe('导入脑图')
  })

  it('returns error payload when the stream emits an error event', async () => {
    const logSpy = vi.spyOn(appLogs, 'logAppError').mockImplementation(() => ({
      id: 'log-1',
      kind: 'app_error',
      createdAt: new Date().toISOString(),
      feature: '导入流式接口',
      route: '',
      stage: 'sse_error_event',
      requestSummary: '',
      responseSummary: '',
      errorMessage: '',
      jobId: '',
      requestId: '',
      meta: {},
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createStreamResponse([
          'event: status\n',
          'data: {"phase":"extracting_text","message":"正在提取图片文字","step":2,"total_steps":3}\n\n',
          'event: error\n',
          'data: {"error":"模型返回内容格式异常。"}\n\n',
        ]),
      ),
    )

    const result = await previewImageTextApi(new File(['x'], 'demo.png', { type: 'image/png' }))

    expect(result).toEqual({
      ok: false,
      error: '模型返回内容格式异常。',
    })
    expect(logSpy).toHaveBeenCalled()
  })

  it('falls back to regular JSON responses when SSE is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createStreamResponse(
          [JSON.stringify({ ok: true, extracted_text: '第一章\n第一节' })],
          'application/json',
        ),
      ),
    )

    const result = await previewImageTextApi(new File(['x'], 'demo.png', { type: 'image/png' }))

    expect(result).toEqual({
      ok: true,
      extracted_text: '第一章\n第一节',
    })
  })
})

