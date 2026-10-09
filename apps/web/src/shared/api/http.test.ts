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

  it('sends a correlation id on every request so the server log can be matched', async () => {
    // The backend accepts and echoes X-Request-ID, but the client never sent one.
    // Consequence measured 2026-10-07: a request killed by a lock or timeout has
    // no response, so no server id ever reached the browser and nothing could be
    // matched against logs/pwa-api.log. One action must yield one id.
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/palaces')

    const headers = readFirstFetchInit(fetchMock).headers as Record<string, string>
    expect(headers['X-Request-ID']).toEqual(expect.any(String))
    expect(headers['X-Request-ID'].length).toBeGreaterThan(0)
  })

  it('keeps a caller supplied correlation id so a retry stays on one trace', async () => {
    // Attempt 2 of the same user action must correlate with attempt 1 in the log,
    // otherwise a retried card looks like two unrelated requests.
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/palaces', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'X-Request-ID': 'trace-card-abc' },
      persistence: false,
    })

    const headers = readFirstFetchInit(fetchMock).headers as Record<string, string>
    expect(headers['X-Request-ID']).toBe('trace-card-abc')
  })

  it('gives different requests different correlation ids', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/palaces')
    await request('/review/units')

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const first = calls[0][1].headers as Record<string, string>
    const second = calls[1][1].headers as Record<string, string>
    expect(first['X-Request-ID']).not.toBe(second['X-Request-ID'])
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
      /正在重新连上.*不用重启/s,
    )
    await expect(request('/review/session/2063')).rejects.not.toThrow(/start-all\.bat/)
    await expect(request('/review/session/2063')).rejects.not.toThrow(/8012|5173/)
    await expect(request('/review/session/2063')).rejects.not.toThrow(/手机 Tailscale/)
  })

  it('retries a transient local GET failure while the shared service restarts', async () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      userAgent: 'Electron/39.8.10',
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request('/palaces/subjects')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up on a GET that never responds instead of hanging the page forever', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('navigator', { onLine: true, userAgent: 'Electron/39.8.10' })
      // 半开连接：fetch 既不 resolve 也不 reject，只有 signal 能把它取消。
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      vi.stubGlobal('fetch', fetchMock)

      const pending = request('/dashboard').catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(25_000)
      const error = await pending

      expect(String(error)).toMatch(/请求超过 20 秒未响应/)
      // 超时不重试：20s 不该变成 60s。
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('blames backend saturation for a mobile timeout instead of a half-open link', async () => {
    vi.useFakeTimers()
    try {
      // 手机端（非本机）超时。连接是通的——请求已经到达服务端，只是服务端没处理完。
      // 2026-10-05 的事故里，服务端因为连接池耗尽把请求挂了 34s，而提示却让用户去
      // 反复开关 Tailscale。文案必须先指向服务端忙/重启，链路问题只作为最后的兜底。
      vi.stubGlobal('navigator', {
        onLine: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
      })
      // jsdom 的 window.location.href 是 localhost，会被判成「本机运行时」。
      // 手机实际访问的是 Tailscale 域名，这里显式模拟成非本机 URL。
      vi.stubGlobal('location', {
        href: 'https://laptop-20260422kj.tail92e457.ts.net/freestyle-2',
      })
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      vi.stubGlobal('fetch', fetchMock)

      const pending = request('/review/units/abc/sessions', {
        method: 'POST',
        body: JSON.stringify({ round_id: 'r1' }),
        timeoutMs: 15_000,
        persistence: false,
      }).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(20_000)
      const error = String(await pending)

      expect(error).toMatch(/请求超过 15 秒未响应/)
      expect(error).toMatch(/服务端.*没有处理完/)
      expect(error).toMatch(/后端.*忙|正在重启/)
      // 主因判定不该再是 Tailscale，但仍然保留作为最后一步的排查动作。
      expect(error).not.toMatch(/通常是 Tailscale 链路半开/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out when a GET receives headers but its JSON body never finishes', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('navigator', { onLine: true, userAgent: 'Electron/39.8.10' })
      let bodyReadStarted = false
      let requestAborted = false
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          requestAborted = true
        })
        const response = jsonResponse({})
        Object.defineProperty(response, 'json', {
          value: () => {
            bodyReadStarted = true
            return new Promise(() => {})
          },
        })
        return Promise.resolve(response)
      })
      vi.stubGlobal('fetch', fetchMock)

      const pending = request('/dashboard').catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(20_000)
      const error = await pending

      expect(bodyReadStarted).toBe(true)
      expect(requestAborted).toBe(true)
      expect(String(error)).toMatch(/请求超过 20 秒未响应/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves writes unbounded so the mutation queue stays the only authority', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/palaces/subjects', { method: 'POST', body: '{}' })

    expect(readFirstFetchInit(fetchMock).signal).toBeUndefined()
  })

  it('bounds a write only when the caller opts in with timeoutMs', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('navigator', { onLine: true, userAgent: 'Electron/39.8.10' })
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      vi.stubGlobal('fetch', fetchMock)

      const pending = request('/review/units/unit-1/sessions', {
        method: 'POST',
        body: JSON.stringify({ encounter_id: 'encounter-1' }),
        timeoutMs: 15_000,
        persistence: false,
      }).catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(15_000)
      const error = await pending

      expect(String(error)).toMatch(/请求超过 15 秒未响应/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(readFirstFetchInit(fetchMock).signal).toBeInstanceOf(AbortSignal)
      expect(mutationQueueMocks.enqueueMutation).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
