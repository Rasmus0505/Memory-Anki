import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeLiveStudyStream, publishLiveStudyCommand } from './liveStudyApi'

describe('liveStudyApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts commands without queuing persistence', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      accepted: true,
      duplicate: false,
      projection: {
        revision: 1,
        controller_client_id: 'pwa',
        route: '/freestyle',
        surface: 'freestyle',
        view: { currentCardId: 'card-1' },
        timer: null,
        updated_at: '2026-01-01T00:00:00Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await publishLiveStudyCommand({
      clientId: 'pwa',
      operationId: 'op-1',
      takeControl: true,
      surface: 'freestyle',
      route: '/freestyle',
      view: { currentCardId: 'card-1' },
    })
    expect(result.projection.view).toEqual({ currentCardId: 'card-1' })
    expect(fetchMock).toHaveBeenCalled()
    const init = fetchMock.mock.calls.at(0)?.at(1) as RequestInit | undefined
    expect(init?.method).toBe('POST')
  })

  it('parses snapshot and update SSE events', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: snapshot\ndata: {"publisher_client_id":null,"projection":{"revision":0,"surface":"idle"}}\n\n'))
        controller.enqueue(encoder.encode('event: update\ndata: {"publisher_client_id":"desktop","projection":{"revision":1,"surface":"freestyle","view":{"currentCardId":"card-2"}}}\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const envelopes: Array<{ surface: string }> = []
    await consumeLiveStudyStream('pwa', (envelope) => {
      envelopes.push({ surface: envelope.projection.surface })
    }, new AbortController().signal)
    expect(envelopes.map((item) => item.surface)).toEqual(['idle', 'freestyle'])
  })
})
