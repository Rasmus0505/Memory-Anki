import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'

const saveMocks = vi.hoisted(() => ({
  savePalaceEditorApi: vi.fn(),
  savePalaceEditorWithOptionsApi: vi.fn(),
}))

vi.mock('@/modules/content/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/content/public')>()
  return {
    ...actual,
    savePalaceEditorApi: (...args: unknown[]) => saveMocks.savePalaceEditorApi(...args),
    savePalaceEditorWithOptionsApi: (...args: unknown[]) => saveMocks.savePalaceEditorWithOptionsApi(...args),
  }
})

import { editorStateFromLocalSave, persistPalaceEditor } from './freestyleBranchCardSupport'

const localDoc = {
  root: {
    data: { uid: 'root', text: '本地树' },
    children: [{ data: { uid: 'keep', text: '保留' }, children: [] }],
  },
}

const staleDoc = {
  root: {
    data: { uid: 'root', text: '旧树' },
    children: [
      { data: { uid: 'keep', text: '保留' }, children: [] },
      { data: { uid: 'deleted', text: '应被删除' }, children: [] },
    ],
  },
}

const localState: MindMapEditorState = {
  editor_doc: localDoc,
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
  editor_fingerprint: 'fp-0',
}

describe('persistPalaceEditor', () => {
  beforeEach(() => {
    saveMocks.savePalaceEditorApi.mockReset()
    saveMocks.savePalaceEditorWithOptionsApi.mockReset()
  })

  it('keeps the local editor_doc when an ack response has no document', async () => {
    saveMocks.savePalaceEditorApi.mockResolvedValue({
      editor_fingerprint: 'fp-1',
      snapshot: {
        schemaVersion: 1,
        editorPreferences: {},
        localPreferences: {},
        language: 'zh',
        revision: 'fp-1',
      },
    })

    const result = await persistPalaceEditor(12, localState)

    expect(saveMocks.savePalaceEditorApi).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        editor_doc: localDoc,
        expected_editor_fingerprint: 'fp-0',
      }),
      'ack',
    )
    expect(result.state.editor_doc).toBe(localDoc)
    expect(result.state.editor_fingerprint).toBe('fp-1')
  })

  it('ignores a server editor_doc on option flushes and still acks', async () => {
    saveMocks.savePalaceEditorWithOptionsApi.mockResolvedValue({
      editor_doc: staleDoc,
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
      editor_fingerprint: 'fp-2',
      unit_reconcile: { changed: false },
    })

    const result = await persistPalaceEditor(12, localState, {
      reconcileUnits: true,
      syncReason: 'return_to_review',
    })

    expect(saveMocks.savePalaceEditorWithOptionsApi).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        editor_doc: localDoc,
        expected_editor_fingerprint: 'fp-0',
        response_mode: 'ack',
        reconcile_units: true,
        sync_reason: 'return_to_review',
      }),
    )
    expect(result.state.editor_doc).toBe(localDoc)
    expect(result.state.editor_fingerprint).toBe('fp-2')
    expect(result.unitReconcile).toEqual({ changed: false })
  })

  it('adopts only the fingerprint from a mixed save response', () => {
    const next = editorStateFromLocalSave(localState, {
      editor_doc: staleDoc,
      editor_fingerprint: 'fp-9',
    })
    expect(next.editor_doc).toBe(localDoc)
    expect(next.editor_fingerprint).toBe('fp-9')
  })
})
