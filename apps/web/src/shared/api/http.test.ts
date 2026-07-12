import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setApiToken } from './apiToken'
import { fetchWithMutationQueue, request, uploadWithFormData } from './http'

const mutationQueueMocks = vi.hoisted(() => ({
  discardQueuedMutationsByCoalesceKey: vi.fn(),
  enqueueMutation: vi.fn(),
  isQueuedReplayRequest: vi.fn(),
  replayQueuedMutations: vi.fn(),
}))

vi.mock('@/shared/logs/model/appLogs', () => ({
  logAppError: vi.fn(),
}))

vi.mock('@/shared/persistence/mutationQueue', () => ({
  discardQueuedMutationsByCoalesceKey: mutationQueueMocks.discardQueuedMutationsByCoalesceKey,
  enqueueMutation: mutationQueueMocks.enqueueMutation,
  isQueuedReplayRequest: mutationQueueMocks.isQueuedReplayRequest,
  replayQueuedMutations: mutationQueueMocks.replayQueuedMutations,
}))

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
}

function readFirstFetchInit(fetchMock: { mock: { calls: unknown[] } }) {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return init
}

describe('shared api http token headers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    mutationQueueMocks.discardQueuedMutationsByCoalesceKey.mockResolvedValue(undefined)
    mutationQueueMocks.enqueueMutation.mockResolvedValue({ replayMode: 'manual', status: 'manual' })
    mutationQueueMocks.isQueuedReplayRequest.mockReturnValue(false)
    mutationQueueMocks.replayQueuedMutations.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('adds the stored API token to JSON requests without adding mutation ids to GETs', async () => {
    setApiToken('stored-token')
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request('/palaces')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/palaces',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Memory-Anki-Token': 'stored-token',
        }),
      }),
    )
    const init = readFirstFetchInit(fetchMock)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Memory-Anki-Mutation-ID']).toBeUndefined()
  })

  it('lets caller supplied request headers override the stored API token', async () => {
    setApiToken('stored-token')
    const fetchMock = vi.fn(async () => jsonResponse({ created: true }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/palaces', {
      method: 'POST',
      body: JSON.stringify({ title: 'Memory Palace' }),
      headers: {
        'Content-Type': 'application/problem+json',
        'X-Memory-Anki-Token': 'caller-token',
      },
      persistence: false,
    })

    const init = readFirstFetchInit(fetchMock)
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/problem+json')
    expect(headers['X-Memory-Anki-Token']).toBe('caller-token')
    expect(headers['X-Memory-Anki-Mutation-ID']).toEqual(expect.any(String))
  })

  it('adds the stored API token and mutation id when fetching through the mutation queue path', async () => {
    setApiToken('queue-token')
    const fetchMock = vi.fn(async () => textResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchWithMutationQueue(
        '/api/v1/palaces/1/editor',
        {
          method: 'PUT',
          body: JSON.stringify({ editor_doc: {} }),
          headers: { 'X-Trace-ID': 'trace-1' },
        },
        {
          resourceKey: 'palace:1:editor',
          coalesceKey: 'palace:1:editor',
          description: '保存宫殿脑图',
        },
      ),
    ).resolves.toBeInstanceOf(Response)

    const init = readFirstFetchInit(fetchMock)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Trace-ID']).toBe('trace-1')
    expect(headers['X-Memory-Anki-Token']).toBe('queue-token')
    expect(headers['X-Memory-Anki-Mutation-ID']).toEqual(expect.any(String))
    expect(mutationQueueMocks.discardQueuedMutationsByCoalesceKey).toHaveBeenCalledWith(
      'palace:1:editor',
    )
  })

  it('preserves browser FormData content headers while adding the stored API token', async () => {
    setApiToken('upload-token')
    const fetchMock = vi.fn(async () => jsonResponse({ uploaded: true }))
    vi.stubGlobal('fetch', fetchMock)
    const formData = new FormData()
    formData.append('file', new Blob(['mindmap']), 'mindmap.json')

    await expect(
      uploadWithFormData('/imports/mindmap', formData, {
        resourceKey: 'mindmap-import',
        description: '导入脑图',
      }),
    ).resolves.toEqual({ uploaded: true })

    const init = readFirstFetchInit(fetchMock)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Memory-Anki-Token']).toBe('upload-token')
    expect(headers['X-Memory-Anki-Mutation-ID']).toEqual(expect.any(String))
    expect(headers['Content-Type']).toBeUndefined()
    expect(init.body).toBe(formData)
  })

  it('includes actionable request context in HTTP errors', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ detail: '会话版本冲突，请刷新后重试' }),
      {
        status: 409,
        headers: {
          'content-type': 'application/json',
          'X-Request-ID': 'req-session-409',
        },
      },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request('/study-sessions/session-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
      persistence: {
        resourceKey: 'session:1',
        description: '保存学习会话',
      },
    })).rejects.toThrow(
      /会话版本冲突，请刷新后重试.*操作：保存学习会话.*请求：PATCH \/api\/v1\/study-sessions\/session-1.*HTTP 状态：409.*请求 ID：req-session-409/s,
    )
  })

  it('shows shared local service guidance for Electron network failures', async () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39.8.10 Safari/537.36',
    })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))

    await expect(request('/review/session/2063')).rejects.toThrow(
      /本机共享服务尚未启动.*暂时无法连接/s,
    )
    await expect(request('/review/session/2063')).rejects.not.toThrow(/8012|5173/)
    await expect(request('/review/session/2063')).rejects.not.toThrow(/手机 Tailscale/)
  })
})
