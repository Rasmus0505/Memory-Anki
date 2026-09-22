import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  MEMORY_LOOKUP_EDIT_AUTOSAVE_MS,
  persistMemoryLookupPalaceEdit,
  useMemoryLookupEditDocument,
} from './memoryLookupEditSession'

const saveMocks = vi.hoisted(() => ({
  savePalaceEditorApi: vi.fn(),
  appConfirm: vi.fn(),
}))

vi.mock('@/modules/content/public', () => ({
  savePalaceEditorApi: (...args: unknown[]) => saveMocks.savePalaceEditorApi(...args),
}))

vi.mock('@/shared/components/ui/native-dialog', () => ({
  appConfirm: (...args: unknown[]) => saveMocks.appConfirm(...args),
}))

function editorState(text: string, fingerprint = 'fp-1'): MindMapEditorState {
  return {
    editor_doc: { root: { data: { uid: 'root', text }, children: [] } },
    editor_config: {},
    editor_local_config: {},
    lang: 'zh',
    editor_fingerprint: fingerprint,
  }
}

describe('persistMemoryLookupPalaceEdit', () => {
  beforeEach(() => {
    saveMocks.savePalaceEditorApi.mockReset()
    saveMocks.appConfirm.mockReset()
  })

  it('autosaves the full document and retries a confirmed dangerous wipe as palace edit', async () => {
    saveMocks.savePalaceEditorApi
      .mockRejectedValueOnce(new Error('检测到危险结构变更：新导图节点数骤减，已拒绝保存。'))
      .mockResolvedValueOnce({ editor_fingerprint: 'fp-2', unit_reconcile: { changed: true } })
    saveMocks.appConfirm.mockResolvedValue(true)
    const state = editorState('删减后')

    const result = await persistMemoryLookupPalaceEdit(7, state, 'fp-1', {
      syncReason: 'editor_leave',
    })

    expect(result).toEqual({ editorFingerprint: 'fp-2', unitReconcile: true })
    expect(saveMocks.savePalaceEditorApi).toHaveBeenNthCalledWith(1, 7, expect.objectContaining({
      editor_doc: state.editor_doc,
      expected_editor_fingerprint: 'fp-1',
      sync_reason: 'editor_leave',
      reconcile_units: true,
    }), 'ack')
    expect(saveMocks.savePalaceEditorApi).toHaveBeenNthCalledWith(2, 7, expect.objectContaining({
      editor_source: 'palace_edit',
      confirm_dangerous_change: true,
      editor_doc: state.editor_doc,
    }), 'ack')
  })
})

describe('useMemoryLookupEditDocument', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces an edit, then chains the next save from the saved fingerprint', async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce({ editorFingerprint: 'fp-2', unitReconcile: false })
      .mockResolvedValueOnce({ editorFingerprint: 'fp-3', unitReconcile: false })
    const source = editorState('原文', 'fp-1')
    const { result } = renderHook(() => useMemoryLookupEditDocument(4, source, persist))

    await act(async () => {
      await Promise.resolve()
    })

    const edited = editorState('改过', 'fp-1')
    act(() => {
      result.current.handleEditorStateChange(edited)
    })
    expect(persist).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MEMORY_LOOKUP_EDIT_AUTOSAVE_MS)
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(4, edited, 'fp-1', undefined)

    const editedAgain = editorState('再改', 'fp-1')
    act(() => {
      result.current.handleEditorStateChange(editedAgain)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MEMORY_LOOKUP_EDIT_AUTOSAVE_MS)
    })
    expect(persist).toHaveBeenNthCalledWith(2, 4, editedAgain, 'fp-2', undefined)
  })

  it('flushes the palace being left instead of writing it onto the next palace', async () => {
    const persist = vi.fn().mockResolvedValue({ editorFingerprint: 'fp-9', unitReconcile: false })
    const first = editorState('甲', 'fp-a')
    const second = editorState('乙', 'fp-b')
    const { result, rerender } = renderHook(
      ({ palaceId, source }: { palaceId: number; source: MindMapEditorState }) => (
        useMemoryLookupEditDocument(palaceId, source, persist)
      ),
      { initialProps: { palaceId: 1, source: first } },
    )
    await act(async () => {
      await Promise.resolve()
    })
    const edited = editorState('甲-改', 'fp-a')
    act(() => {
      result.current.handleEditorStateChange(edited)
    })

    rerender({ palaceId: 2, source: second })
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(MEMORY_LOOKUP_EDIT_AUTOSAVE_MS)
    })

    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(1, edited, 'fp-a', { syncReason: 'editor_leave' })
    expect(result.current.editorState).toBe(second)
  })
})
