import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setApiToken } from '@/shared/api/apiToken'
import {
  confirmQueuedMutationOverwrite,
  discardQueuedConflictsByCoalesceKey,
  enqueueMutation,
  readQueuedMutations,
  replayQueuedMutations,
  resetMutationQueueForTest,
  retryQueuedConflictWithCurrentFingerprint,
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

  it('parks a rating left in the queue by an older build instead of replaying it', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await enqueueMutation({
      mutationId: 'legacy-rating',
      resourceKey: 'rating:legacy',
      description: '保存评分',
      url: '/api/v1/freestyle/rounds/r1/ratings',
      method: 'POST',
      bodyKind: 'json',
      body: JSON.stringify({ rating: 3 }),
      replayMode: 'auto',
    })

    await replayQueuedMutations()

    expect(fetchMock).not.toHaveBeenCalled()
    const [item] = await readQueuedMutations()
    expect(item?.status).toBe('manual')
    expect(item?.replayMode).toBe('manual')
    expect(item?.errorMessage).toContain('没有保存成功')
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

  it('does not replay conflict or manual entries when a queue scan forces them', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const conflict = await enqueueMutation({
      id: 'conflict-entry',
      resourceKey: 'palace:1:editor',
      url: '/api/v1/palaces/1/editor',
      method: 'PUT',
      bodyKind: 'json',
      body: JSON.stringify({ expected_editor_fingerprint: 'stale' }),
      replayMode: 'auto',
      initialStatus: 'conflict',
    })
    const manual = await enqueueMutation({
      id: 'manual-entry',
      resourceKey: 'palace:2:editor',
      url: '/api/v1/palaces/2/editor',
      method: 'PUT',
      bodyKind: 'json',
      body: JSON.stringify({ expected_editor_fingerprint: 'stale' }),
      replayMode: 'auto',
      initialStatus: 'manual',
    })

    await replayQueuedMutations()

    expect(fetchMock).not.toHaveBeenCalled()
    expect((await readQueuedMutations()).map((item) => item.status)).toEqual(['conflict', 'manual'])

    // `forceIds` remains the explicit-retry escape hatch for user actions.
    await replayQueuedMutations({ forceIds: [manual.id] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps conflicts pending until the user confirms overwrite', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '脑图保存冲突' }), { status: 409 }))
      // Confirmation first re-reads the server revision, then replays the save.
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ editor_fingerprint: 'server-current' }), { status: 200 }),
      )
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

    const [probeUrl] = fetchMock.mock.calls[1] as unknown as [string]
    expect(probeUrl).toContain('/api/v1/palaces/1/editor')

    const [, confirmedInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit]
    const confirmedBody = JSON.parse((confirmedInit?.body as string) || '{}')
    expect(confirmedBody).toMatchObject({
      confirm_dangerous_change: true,
      editor_source: 'palace_edit',
      // The overwrite must be signed with the revision the server reported, not
      // the superseded one that produced the original 409.
      expected_editor_fingerprint: 'server-current',
    })
    // The local document is still what gets written.
    expect(confirmedBody.editor_doc.root.data.text).toBe('本地版本')
    expect(confirmedBody).not.toHaveProperty('allow_stale_overwrite')
    expect(await readQueuedMutations()).toHaveLength(0)
  })

  it('releases a parked conflict by re-signing it with the current fingerprint', async () => {
    setApiToken('token')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ detail: { code: 'mindmap_conflict', message: '脑图保存冲突' } }),
        { status: 409 },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ editor_fingerprint: 'server-now' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const item = await enqueueMutation({
      resourceKey: 'palace:7:editor',
      coalesceKey: 'palace:7:editor',
      description: '保存宫殿脑图',
      url: '/api/v1/palaces/7/editor',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'json',
      body: JSON.stringify({
        editor_doc: { root: { data: { text: '本地' }, children: [] } },
        expected_editor_fingerprint: 'rejected',
      }),
      replayMode: 'auto',
    })
    await replayQueuedMutations()
    expect((await readQueuedMutations())[0]?.status).toBe('conflict')

    // Ordinary scans must keep skipping it: that guard is what stopped the
    // once-a-minute 409 storm.
    await replayQueuedMutations()
    expect((await readQueuedMutations())[0]?.status).toBe('conflict')

    // The explicit recovery path is the only thing that may send it again.
    await expect(retryQueuedConflictWithCurrentFingerprint(item.id)).resolves.toBe(true)

    const [, confirmedInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit]
    expect(JSON.parse((confirmedInit?.body as string) || '{}')).toMatchObject({
      expected_editor_fingerprint: 'server-now',
      confirm_dangerous_change: true,
    })
    expect(await readQueuedMutations()).toHaveLength(0)
  })

  it('drops parked conflicts for a resource the session already resolved', async () => {
    for (const status of ['conflict', 'manual'] as const) {
      await enqueueMutation({
        resourceKey: 'palace:9:editor',
        coalesceKey: 'palace:9:editor',
        description: '保存宫殿脑图',
        url: '/api/v1/palaces/9/editor',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        bodyKind: 'json',
        body: JSON.stringify({ expected_editor_fingerprint: 'stale' }),
        initialStatus: status,
      })
    }
    await enqueueMutation({
      resourceKey: 'palace:9:editor',
      coalesceKey: 'palace:9:editor',
      description: '保存宫殿脑图',
      url: '/api/v1/palaces/9/editor',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'json',
      body: JSON.stringify({ expected_editor_fingerprint: 'stale' }),
      initialStatus: 'pending',
    })
    await enqueueMutation({
      resourceKey: 'palace:10:editor',
      coalesceKey: 'palace:10:editor',
      description: '另一个宫殿',
      url: '/api/v1/palaces/10/editor',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'json',
      body: JSON.stringify({ expected_editor_fingerprint: 'other' }),
      initialStatus: 'conflict',
    })

    await discardQueuedConflictsByCoalesceKey('palace:9:editor')

    const remaining = await readQueuedMutations()
    // The still-runnable pending entry and the unrelated palace survive.
    expect(remaining.map((entry) => entry.coalesceKey)).toEqual([
      'palace:9:editor',
      'palace:10:editor',
    ])
    expect(remaining.map((entry) => entry.status)).toEqual(['pending', 'conflict'])
  })
})
