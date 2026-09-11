import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { useMindMapDocumentSession } from './useMindMapDocumentSession'

interface TestMeta {
  id: number
  title: string
}

interface TestResponse extends MindMapEditorState {
  entity: TestMeta
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

function selectEditorState(response: TestResponse): MindMapEditorState {
  return {
    editor_doc: response.editor_doc,
    editor_config: response.editor_config,
    editor_local_config: response.editor_local_config,
    lang: response.lang,
    editor_fingerprint: response.editor_fingerprint,
  }
}

describe('useMindMapDocumentSession force flush', () => {
  it('does not save on flushSave when the document is already clean', async () => {
    const saver = vi.fn(async (id: number, data: MindMapEditorState) => ({
      entity: { id, title: 'saved' },
      ...data,
      editor_fingerprint: 'fp-clean',
    }))
    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 13,
        fetcher: vi.fn(async () => buildResponse(13, '已保存')),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState,
      }),
    )

    await waitFor(() => {
      expect(result.current.editorState).not.toBeNull()
    })

    await act(async () => {
      await result.current.flushSave()
    })
    expect(saver).not.toHaveBeenCalled()
  })

  it('force flushSave still posts the current snapshot after autosave cleared dirty', async () => {
    const saver = vi.fn(async (id: number, data: MindMapEditorState) => ({
      entity: { id, title: 'saved' },
      ...data,
      editor_fingerprint: `fp-${id}-${saver.mock.calls.length}`,
    }))
    const { result } = renderHook(() =>
      useMindMapDocumentSession<TestResponse, TestMeta>({
        entityId: 14,
        fetcher: vi.fn(async () => buildResponse(14, '初始')),
        saver,
        selectMeta: (response) => response.entity,
        selectEditorState,
      }),
    )

    await waitFor(() => {
      expect(result.current.editorState).not.toBeNull()
    })

    await act(async () => {
      result.current.setEditorState(buildResponse(14, '已标记'))
    })
    await act(async () => {
      await result.current.flushSave()
    })
    expect(saver).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.flushSave()
    })
    expect(saver).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.flushSave({ force: true })
    })
    expect(saver).toHaveBeenCalledTimes(2)
    expect(
      (saver.mock.calls[1]?.[1]?.editor_doc as { root?: { data?: { text?: string } } })?.root?.data?.text,
    ).toBe('已标记')
  })
})
