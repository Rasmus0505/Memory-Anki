import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  buildMindMapEditorDraftKey,
  readMindMapEditorDraft,
  resetMindMapEditorDraftStoreForTest,
  stableMindMapEditorContentFingerprint,
  writeMindMapEditorDraft,
} from '@/shared/persistence/mindmapEditorDraftStore'
import { useMindMapDocumentSession } from './useMindMapDocumentSession'

interface TestMeta {
  id: number
  title: string
}

interface TestResponse extends MindMapEditorState {
  entity: TestMeta
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

function buildResponse(id: number, title: string): TestResponse {
  return {
    entity: { id, title },
    editor_doc: {
      root: {
        data: { text: title, uid: `uid-${id}` },
        children: [],
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
    editor_fingerprint: `fingerprint-${id}-${title}`,
  }
}

function buildResponseWithChildren(id: number, title: string, childCount: number): TestResponse {
  return {
    entity: { id, title },
    editor_doc: {
      root: {
        data: { text: title, uid: `uid-${id}` },
        children: Array.from({ length: childCount }, (_, index) => ({
          data: { text: `节点${index + 1}`, uid: `uid-${id}-${index + 1}` },
          children: [],
        })),
      },
    },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
    editor_fingerprint: `fingerprint-${id}-${title}-${childCount}`,
  }
}

function renderPersistedEditorHook(
  entityId: number | null,
  fetcher: (id: number) => Promise<TestResponse>,
) {
  return renderHook(
    ({ nextEntityId }) =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: nextEntityId,
        fetcher,
        saver: vi.fn(async (id, data) => ({
          entity: { id, title: `saved-${id}` },
          ...data,
        })),
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
      }),
    {
      initialProps: { nextEntityId: entityId },
    },
  )
}

describe('useMindMapDocumentSession', () => {
  beforeEach(async () => {
    await resetMindMapEditorDraftStoreForTest()
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await resetMindMapEditorDraftStoreForTest()
  })

  it('classifies an initial fetch failure as a load error', async () => {
    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 32,
        fetcher: vi.fn(async () => {
          throw Object.assign(new Error('not found'), { status: 404 })
        }),
        saver: vi.fn(),
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => response,
      }),
    )

    await waitFor(() => {
      expect(result.current.isLoadError).toBe(true)
    })
    expect(result.current.error).toContain('not found')
    expect(result.current.saveStatus).toBe('error')
  })

  it('ignores stale load responses after the entity changes', async () => {
    const firstLoad = createDeferred<TestResponse>()
    const secondLoad = createDeferred<TestResponse>()
    const fetcher = vi.fn((id: number) => {
      if (id === 1) return firstLoad.promise
      if (id === 2) return secondLoad.promise
      throw new Error(`unexpected id ${id}`)
    })

    const { result, rerender } = renderPersistedEditorHook(1, fetcher)

    expect(fetcher).toHaveBeenCalledWith(1)

    rerender({ nextEntityId: 2 })
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(2)
    })

    await act(async () => {
      secondLoad.resolve(buildResponse(2, '第二个宫殿'))
    })

    await waitFor(() => {
      expect(result.current.meta).toEqual({ id: 2, title: '第二个宫殿' })
    })

    await act(async () => {
      firstLoad.resolve(buildResponse(1, '第一个宫殿'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.meta).toEqual({ id: 2, title: '第二个宫殿' })
    expect((result.current.editorState?.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text).toBe(
      '第二个宫殿',
    )
  })

  it('clears the previous editor state while loading the next entity', async () => {
    const firstLoad = createDeferred<TestResponse>()
    const secondLoad = createDeferred<TestResponse>()
    const fetcher = vi.fn((id: number) => {
      if (id === 1) return firstLoad.promise
      if (id === 2) return secondLoad.promise
      throw new Error(`unexpected id ${id}`)
    })

    const { result, rerender } = renderPersistedEditorHook(1, fetcher)

    await act(async () => {
      firstLoad.resolve(buildResponse(1, '第一个宫殿'))
    })

    await waitFor(() => {
      expect(result.current.meta).toEqual({ id: 1, title: '第一个宫殿' })
    })

    rerender({ nextEntityId: 2 })

    await waitFor(() => {
      expect(result.current.meta).toBeNull()
      expect(result.current.editorState).toBeNull()
    })

    await act(async () => {
      secondLoad.resolve(buildResponse(2, '第二个宫殿'))
    })

    await waitFor(() => {
      expect(result.current.meta).toEqual({ id: 2, title: '第二个宫殿' })
    })
  })

  it('only applies the latest response when reload is triggered multiple times for the same entity', async () => {
    const initialLoad = createDeferred<TestResponse>()
    const olderReload = createDeferred<TestResponse>()
    const latestReload = createDeferred<TestResponse>()
    const fetcherCalls = [initialLoad.promise, olderReload.promise, latestReload.promise]
    const fetcher = vi.fn(() => {
      const next = fetcherCalls.shift()
      if (!next) {
        throw new Error('unexpected extra fetch')
      }
      return next
    })

    const { result } = renderPersistedEditorHook(7, fetcher)

    await act(async () => {
      initialLoad.resolve(buildResponse(7, '初始版本'))
    })

    await waitFor(() => {
      expect(result.current.meta).toEqual({ id: 7, title: '初始版本' })
    })

    await act(async () => {
      void result.current.reload()
      void result.current.reload()
    })

    expect(fetcher).toHaveBeenCalledTimes(3)

    await act(async () => {
      latestReload.resolve(buildResponse(7, '最新版本'))
    })

    await waitFor(() => {
      expect(result.current.meta).toEqual({ id: 7, title: '最新版本' })
    })

    await act(async () => {
      olderReload.resolve(buildResponse(7, '过期版本'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.meta).toEqual({ id: 7, title: '最新版本' })
    expect((result.current.editorState?.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text).toBe(
      '最新版本',
    )
  })

  it('blocks autosave when beforeAutoSave detects a stale smaller writeback', async () => {
    vi.useFakeTimers()
    const saver = vi.fn(async (id: number, data: MindMapEditorState) => ({
      entity: { id, title: `saved-${id}` },
      ...data,
    }))

    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 7,
        fetcher: vi.fn(async () => buildResponseWithChildren(7, '最新版本', 8)),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
        beforeAutoSave: (nextState, currentState) => {
          const nextChildren =
            ((nextState.editor_doc as { root?: { children?: unknown[] } })?.root?.children?.length ?? 0)
          const currentChildren =
            ((currentState?.editor_doc as { root?: { children?: unknown[] } })?.root?.children?.length ?? 0)
          return currentChildren >= 8 && nextChildren <= 3 ? 'blocked stale writeback' : null
        },
      }),
    )

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.setEditorState(buildResponseWithChildren(7, '旧版本', 3))
    })

    expect(result.current.error).toBe('blocked stale writeback')
    expect(saver).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('sends the last server editor fingerprint with autosave payloads', async () => {
    const saver = vi.fn(async (id: number, data: MindMapEditorState & { expected_editor_fingerprint?: string | null }) => ({
      entity: { id, title: `saved-${id}` },
      ...data,
      editor_fingerprint: data.editor_doc && (data.editor_doc as { root?: { data?: { text?: string } } }).root?.data?.text === '第二次'
        ? 'fingerprint-after-second-save'
        : 'fingerprint-after-first-save',
    }))

    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 7,
        fetcher: vi.fn(async () => ({
          ...buildResponse(7, '初始版本'),
          editor_fingerprint: 'fingerprint-initial',
        })),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
      }),
    )

    await waitFor(() => {
      expect(result.current.editorState?.editor_fingerprint).toBe('fingerprint-initial')
    })

    vi.useFakeTimers()
    act(() => {
      result.current.setEditorState(buildResponse(7, '第一次'))
      vi.advanceTimersByTime(450)
    })

    await act(async () => {
      await flushAsyncWork()
    })
    expect(saver).toHaveBeenCalledTimes(1)
    expect(saver.mock.calls[0]?.[1].expected_editor_fingerprint).toBe('fingerprint-initial')

    act(() => {
      result.current.setEditorState(buildResponse(7, '第二次'))
      vi.advanceTimersByTime(450)
    })

    await act(async () => {
      await flushAsyncWork()
    })
    expect(saver).toHaveBeenCalledTimes(2)
    expect(saver.mock.calls[1]?.[1].expected_editor_fingerprint).toBe('fingerprint-after-first-save')
    vi.useRealTimers()
  })

  it('drops a failed save after switching owners without retrying against the new owner', async () => {
    const firstSave = createDeferred<TestResponse>()
    const fetcher = vi.fn(async (id: number) => buildResponse(id, id === 1 ? '宫殿 A' : '宫殿 B'))
    const saver = vi.fn((id: number, data: MindMapEditorState) => {
      if (id === 1) return firstSave.promise
      return Promise.resolve({
        entity: { id, title: `saved-${id}` },
        ...data,
        editor_fingerprint: `saved-fingerprint-${id}`,
      })
    })
    const onSaveError = vi.fn(() => false)

    const { result, rerender } = renderHook(
      ({ nextEntityId }) =>
        useMindMapDocumentSession<TestResponse, TestMeta>({
          entityId: nextEntityId,
          fetcher,
          saver,
          selectMeta: (response) => response.entity,
          selectEditorState: (response) => ({
            editor_doc: response.editor_doc,
            editor_config: response.editor_config,
            editor_local_config: response.editor_local_config,
            lang: response.lang,
            editor_fingerprint: response.editor_fingerprint,
          }),
          onSaveError,
        }),
      { initialProps: { nextEntityId: 1 } },
    )

    await waitFor(() => {
      expect(result.current.meta).toEqual({ id: 1, title: '宫殿 A' })
    })

    vi.useFakeTimers()
    act(() => {
      result.current.setEditorState(buildResponse(1, 'A 的未完成保存'))
      vi.advanceTimersByTime(450)
    })
    await act(async () => {
      await flushAsyncWork()
    })

    expect(saver).toHaveBeenCalledTimes(1)
    expect(saver.mock.calls[0]?.[0]).toBe(1)

    rerender({ nextEntityId: 2 })
    await act(async () => {
      await flushAsyncWork()
    })
    expect(result.current.meta).toEqual({ id: 2, title: '宫殿 B' })

    await act(async () => {
      firstSave.reject(new Error('A save failed'))
      await flushAsyncWork()
    })
    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flushAsyncWork()
    })

    expect(saver).toHaveBeenCalledTimes(1)
    expect(saver.mock.calls.some(([ownerId]) => ownerId === 2)).toBe(false)
    expect(onSaveError).not.toHaveBeenCalled()
    expect(result.current.meta).toEqual({ id: 2, title: '宫殿 B' })
    expect(result.current.error).toBeNull()
    expect((result.current.editorState?.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text).toBe('宫殿 B')
    vi.useRealTimers()
  })
  it('keeps failed autosave dirty so a later flush can still persist it', async () => {
    const saver = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(async (id: number, data: MindMapEditorState) => ({
        entity: { id, title: `saved-${id}` },
        ...data,
        editor_fingerprint: 'fingerprint-after-recovery',
      }))

    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 7,
        fetcher: vi.fn(async () => buildResponse(7, '初始版本')),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
      }),
    )

    await waitFor(() => {
      expect(result.current.editorState).not.toBeNull()
    })

    vi.useFakeTimers()
    act(() => {
      result.current.setEditorState(buildResponse(7, '离线编辑'))
      vi.advanceTimersByTime(450)
    })
    await act(async () => {
      await flushAsyncWork()
    })
    expect(saver).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(500)
      await flushAsyncWork()
    })
    expect(saver).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await flushAsyncWork()
    })
    expect(saver).toHaveBeenCalledTimes(3)

    await act(async () => {
      await result.current.flushSave()
    })

    expect(saver).toHaveBeenCalledTimes(4)
    expect(result.current.error).toBeNull()
    vi.useRealTimers()
  })

  it('saves the latest pending snapshot after an in-flight save finishes (rapid edits 1→2→3)', async () => {
    const firstSave = createDeferred<TestResponse>()
    let saveCalls = 0
    const saver = vi.fn((id: number, data: MindMapEditorState) => {
      saveCalls += 1
      if (saveCalls === 1) {
        return firstSave.promise.then(() => ({
          entity: { id, title: 'saved-1' },
          ...data,
          editor_fingerprint: 'fp-after-1',
        }))
      }
      return Promise.resolve({
        entity: { id, title: `saved-${saveCalls}` },
        ...data,
        editor_fingerprint: `fp-after-${saveCalls}`,
      })
    })

    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 9,
        fetcher: vi.fn(async () => buildResponse(9, '初始')),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
      }),
    )

    await waitFor(() => {
      expect(result.current.editorState).not.toBeNull()
    })

    vi.useFakeTimers()
    act(() => {
      result.current.setEditorState(buildResponse(9, '修改一'))
      vi.advanceTimersByTime(450)
    })
    await act(async () => {
      await flushAsyncWork()
    })
    expect(saver).toHaveBeenCalledTimes(1)
    expect(
      (saver.mock.calls[0]?.[1].editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text,
    ).toBe('修改一')

    act(() => {
      result.current.setEditorState(buildResponse(9, '修改二'))
      result.current.setEditorState(buildResponse(9, '修改三'))
    })

    await act(async () => {
      firstSave.resolve({
        entity: { id: 9, title: 'saved-1' },
        ...buildResponse(9, '修改一'),
        editor_fingerprint: 'fp-after-1',
      })
      await flushAsyncWork()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await flushAsyncWork()
    })

    expect(saver).toHaveBeenCalledTimes(2)
    expect(
      (saver.mock.calls[1]?.[1].editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text,
    ).toBe('修改三')
    vi.useRealTimers()
  })

  it('writes a local draft on edit and recovers it when server is older', async () => {
    const draftKey = buildMindMapEditorDraftKey('persisted-mindmap', 11)
    const recovered = buildResponse(11, '本地未同步的修改三')
    await writeMindMapEditorDraft({
      resourceKey: draftKey,
      snapshot: recovered,
      changeVersion: 3,
      baseEditorFingerprint: 'fingerprint-11-初始',
      contentFingerprint: stableMindMapEditorContentFingerprint(recovered),
    })

    const secondSave = createDeferred<TestResponse>()
    const saver = vi.fn((id: number, data: MindMapEditorState) => {
      return secondSave.promise.then(() => ({
        entity: { id, title: `saved-${id}` },
        ...data,
        editor_fingerprint: 'fp-recovered',
      }))
    })

    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 11,
        fetcher: vi.fn(async () => buildResponse(11, '初始')),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
      }),
    )

    await waitFor(() => {
      expect(
        (result.current.editorState?.editor_doc as { root?: { data?: { text?: string } } })?.root?.data
          ?.text,
      ).toBe('本地未同步的修改三')
    })
    await waitFor(() => {
      expect(saver).toHaveBeenCalled()
    })
    // Recovery must re-save the draft to the server (not only show it in memory).
    expect(
      (saver.mock.calls[0]?.[1].editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text,
    ).toBe('本地未同步的修改三')
    expect(result.current.hasUnsavedChanges || result.current.isSaving).toBe(true)

    await act(async () => {
      secondSave.resolve({
        entity: { id: 11, title: 'saved-11' },
        ...recovered,
        editor_fingerprint: 'fp-recovered',
      })
      await flushAsyncWork()
    })
  })

  it('persists a draft immediately when editing so pagehide cannot lose later edits', async () => {
    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 12,
        fetcher: vi.fn(async () => buildResponse(12, '初始')),
        saver: vi.fn(async (id, data) => ({
          entity: { id, title: `saved-${id}` },
          ...data,
        })),
        selectMeta: (response) => response.entity,
        selectEditorState: (response) => ({
          editor_doc: response.editor_doc,
          editor_config: response.editor_config,
          editor_local_config: response.editor_local_config,
          lang: response.lang,
          editor_fingerprint: response.editor_fingerprint,
        }),
      }),
    )

    await waitFor(() => {
      expect(result.current.editorState).not.toBeNull()
    })

    act(() => {
      result.current.setEditorState(buildResponse(12, '即时草稿'))
    })

    await waitFor(async () => {
      const draft = await readMindMapEditorDraft(buildMindMapEditorDraftKey('persisted-mindmap', 12))
      expect(
        (draft?.snapshot.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text,
      ).toBe('即时草稿')
    })
  })
})


