import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setApiToken } from '@/shared/api/apiToken'
import {
  confirmQueuedMutationOverwrite,
  enqueueMutation,
  readQueuedMutations,
  replayQueuedMutations,
  resetMutationQueueForTest,
} from './mutationQueue'

const REMOVED_MUTATION_QUEUE_EVENT = ['memory-anki', 'mutation-queue:changed'].join('-')

describe('mutationQueue', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    await resetMutationQueueForTest()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await resetMutationQueueForTest()
  })

  it('coalesces snapshot mutations by keeping the latest body', async () => {
    await enqueueMutation({
      resourceKey: 'palace:1:editor',
      coalesceKey: 'palace:1:editor',
      description: '保存宫殿脑图',
      url: '/api/v1/palaces/1/editor',
      method: 'PUT',
      bodyKind: 'json',
      body: JSON.stringify({ version: 1 }),
      replayMode: 'auto',
    })

    await enqueueMutation({
      resourceKey: 'palace:1:editor',
      coalesceKey: 'palace:1:editor',
      description: '保存宫殿脑图',
      url: '/api/v1/palaces/1/editor',
      method: 'PUT',
      bodyKind: 'json',
      body: JSON.stringify({ version: 2 }),
      replayMode: 'auto',
    })

    const items = await readQueuedMutations()
    expect(items).toHaveLength(1)
    expect(JSON.parse(items[0]!.body || '{}')).toEqual({ version: 2 })
  })

  it('does not dispatch the removed mutation queue change event', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    await enqueueMutation({
      resourceKey: 'palace:1:editor',
      description: '保存宫殿脑图',
      url: '/api/v1/palaces/1/editor',
      method: 'PUT',
      replayMode: 'auto',
    })

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: REMOVED_MUTATION_QUEUE_EVENT }),
    )
  })

  it('replays auto mutations with the stored mutation id and removes successful items', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const item = await enqueueMutation({
      mutationId: 'mutation-1',
      resourceKey: 'study-session:record-1',
      description: '保存学习会话',
      url: '/api/v1/study-sessions/from-time-record',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'json',
      body: JSON.stringify({ id: 'record-1' }),
      replayMode: 'auto',
    })

    await replayQueuedMutations()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init?.headers as Headers
    expect(headers.get('X-Memory-Anki-Mutation-ID')).toBe(item.mutationId)
    expect(headers.get('X-Memory-Anki-Queued-Replay')).toBe('true')
    expect(await readQueuedMutations()).toHaveLength(0)
  })

  it('injects the current API token when replaying a legacy queued mutation', async () => {
    setApiToken('current-pwa-token')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await enqueueMutation({
      mutationId: 'legacy-mutation',
      resourceKey: 'study-session:legacy-record',
      description: '恢复旧学习会话',
      url: '/api/v1/study-sessions/from-time-record',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'json',
      body: JSON.stringify({ id: 'legacy-record' }),
      replayMode: 'auto',
    })

    await replayQueuedMutations()

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init?.headers as Headers
    expect(headers.get('X-Memory-Anki-Token')).toBe('current-pwa-token')
    expect(await readQueuedMutations()).toHaveLength(0)
  })

  it('keeps conflicts pending until the user confirms overwrite', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '脑图保存冲突' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const item = await enqueueMutation({
      resourceKey: 'palace:1:editor',
      coalesceKey: 'palace:1:editor',
      description: '保存宫殿脑图',
      url: '/api/v1/palaces/1/editor',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'json',
      body: JSON.stringify({
        editor_doc: { root: { data: { text: '本地版本' }, children: [] } },
        expected_editor_fingerprint: 'server-before-local-edit',
      }),
      replayMode: 'auto',
    })

    await replayQueuedMutations()

    const conflicted = (await readQueuedMutations())[0]
    expect(conflicted?.status).toBe('conflict')
    expect(conflicted?.conflictMessage).toContain('脑图保存冲突')

    await confirmQueuedMutationOverwrite(item.id)
    await replayQueuedMutations({ forceIds: [item.id] })

    const [, confirmedInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse((confirmedInit?.body as string) || '{}')).toMatchObject({
      allow_stale_overwrite: true,
      confirm_dangerous_change: true,
      editor_source: 'palace_edit',
    })
    expect(await readQueuedMutations()).toHaveLength(0)
  })
})
