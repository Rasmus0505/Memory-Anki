import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/client'
import { usePersistedMindMapEditor } from './usePersistedMindMapEditor'

interface TestMeta {
  id: number
  title: string
}

interface TestResponse extends MindMapEditorState {
  entity: TestMeta
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
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
  }
}

function renderPersistedEditorHook(
  entityId: number | null,
  fetcher: (id: number) => Promise<TestResponse>,
) {
  return renderHook(
    ({ nextEntityId }) =>
      usePersistedMindMapEditor<TestResponse, TestMeta>({
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
        }),
      }),
    {
      initialProps: { nextEntityId: entityId },
    },
  )
}

describe('usePersistedMindMapEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
})
