import { afterEach, describe, expect, it, vi } from 'vitest'
import { archiveMindMapEditorConflict, type MindMapEditorConflict } from './mindmapEditorDraftStore'

const conflict: MindMapEditorConflict = { ownerId: 1, operationId: 2,
  localSnapshot: { editor_doc: { text: 'local' }, editor_config: {}, editor_local_config: {}, lang: 'zh' },
  remoteSnapshot: { editor_doc: { text: 'remote' }, editor_config: {}, editor_local_config: {}, lang: 'zh' },
  baseEditorFingerprint: 'r1', remoteEditorFingerprint: 'r2', reason: 'draft-base-mismatch' }

afterEach(() => vi.unstubAllGlobals())

describe('durable conflict archive', () => {
  function database() {
    const put = vi.fn((record: unknown) => ({ result: record }))
    const transaction = { objectStore: () => ({ put }), oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null, error: new Error('aborted') }
    const request = { result: { transaction: () => transaction, close: vi.fn() }, onsuccess: null as (() => void) | null }
    vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => request.onsuccess?.()); return request } })
    return { transaction, put }
  }
  it('waits for transaction commit and stores both snapshots in an independent key', async () => {
    const { transaction, put } = database()
    let settled = false
    const pending = archiveMindMapEditorConflict('document:1', conflict).then(() => { settled = true })
    await vi.waitFor(() => expect(put).toHaveBeenCalled())
    expect(settled).toBe(false)
    expect(put.mock.calls[0][0]).toMatchObject({ ...conflict, resourceKey: expect.stringContaining('document:1:conflict:') })
    transaction.oncomplete?.()
    await pending
    expect(settled).toBe(true)
  })
  it('rejects an aborted transaction instead of acknowledging memory-only preservation', async () => {
    const { transaction, put } = database()
    const pending = archiveMindMapEditorConflict('document:1', conflict)
    const rejected = expect(pending).rejects.toThrow('持久')
    await vi.waitFor(() => expect(put).toHaveBeenCalled())
    transaction.onabort?.()
    await rejected
  })
})
