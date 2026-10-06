import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import * as drafts from '@/shared/persistence/mindmapEditorDraftStore'
import { useMindMapDocumentSession } from './useMindMapDocumentSession'

function snapshot(text: string, revision = text): MindMapEditorState {
  return { editor_doc: { root: { data: { text, uid: 'root' }, children: [] } },
    editor_config: {}, editor_local_config: {}, lang: 'zh', editor_fingerprint: revision }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const remote = snapshot('remote', 'r2')
const local = snapshot('local', 'r1')
function setup(load = vi.fn(async () => remote), save = vi.fn(async (_id: number, value: MindMapEditorState) => value)) {
  const hook = renderHook(({ id }) => useMindMapDocumentSession({ entityId: id,
    loadCacheKey: 'conflict-test', adapter: { load, save, selectMeta: () => null, selectEditorState: (value) => value } }),
  { initialProps: { id: 1 } })
  return { ...hook, save, load }
}
async function seed(base = 'r1') {
  await drafts.writeMindMapEditorDraft({ resourceKey: 'conflict-test:1', snapshot: local, baseEditorFingerprint: base, changeVersion: 1 })
}
beforeEach(() => drafts.resetMindMapEditorDraftStoreForTest())
afterEach(async () => { vi.restoreAllMocks(); await drafts.resetMindMapEditorDraftStoreForTest() })

describe('draft conflict protection', () => {
  it.each(['r1', ''])('blocks auto and forced flush for draft base %j', async (base) => {
    await seed(base)
    const { result, save, unmount } = setup()
    await waitFor(() => expect(result.current.pendingConflict).not.toBeNull())
    expect(result.current.pendingConflict).toMatchObject({ localSnapshot: local, remoteSnapshot: remote })
    await act(() => result.current.flushSave({ force: true }))
    unmount()
    expect(save).not.toHaveBeenCalled()
    expect((await drafts.readMindMapEditorDraft('conflict-test:1'))?.baseEditorFingerprint).toBe(base)
  })
  it('recovers a draft automatically only when its base matches', async () => {
    await seed('r2')
    const { result, save } = setup()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(result.current.pendingConflict).toBeNull()
    expect(save.mock.calls[0][1]).toMatchObject({ expected_editor_fingerprint: 'r2' })
  })
  it('retains the genuine loaded baseline in new drafts and save conflicts', async () => {
    const initial = snapshot('initial', 'r1')
    const load = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(remote)
    const save = vi.fn(async () => { throw Object.assign(new Error('Conflict'), { status: 409 }) })
    const { result } = setup(load, save)
    await waitFor(() => expect(result.current.editorState).toEqual(initial))
    act(() => result.current.setEditorState(local))
    await act(() => result.current.flushSave())
    expect(result.current.pendingConflict?.baselineSnapshot).toEqual(initial)
    expect((await drafts.readMindMapEditorDraft('conflict-test:1'))?.baseSnapshot).toEqual(initial)
  })
  it('ignores a draft read completing after owner change', async () => {
    const delayed = deferred<drafts.MindMapEditorDraftRecord | null>()
    vi.spyOn(drafts, 'readMindMapEditorDraft').mockImplementationOnce(() => delayed.promise)
    const { result, rerender, save } = setup()
    await waitFor(() => expect(drafts.readMindMapEditorDraft).toHaveBeenCalled())
    rerender({ id: 2 })
    await waitFor(() => expect(result.current.editorState).toEqual(remote))
    await act(async () => delayed.resolve({ resourceKey: 'conflict-test:1', snapshot: local,
      baseEditorFingerprint: 'r1', contentFingerprint: drafts.stableMindMapEditorContentFingerprint(local), changeVersion: 1, updatedAt: '' }))
    expect(result.current.editorState).toEqual(remote)
    expect(result.current.pendingConflict).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
  it.each(['local', 'remote', 'manual'] as const)('archives both versions before resolving %s', async (choice) => {
    await seed()
    const archive = deferred<void>()
    const archiveSpy = vi.spyOn(drafts, 'archiveMindMapEditorConflict').mockReturnValue(archive.promise)
    const { result, save } = setup()
    await waitFor(() => expect(result.current.pendingConflict).not.toBeNull())
    const conflict = result.current.pendingConflict!
    let resolution!: Promise<boolean>
    act(() => { resolution = result.current.resolveConflict({ ownerId: 1, operationId: conflict.operationId, choice, snapshot: snapshot('merged') }) })
    expect(archiveSpy).toHaveBeenCalledWith('conflict-test:1', expect.objectContaining({ localSnapshot: local, remoteSnapshot: remote }))
    expect(result.current.pendingConflict).not.toBeNull()
    expect(save).not.toHaveBeenCalled()
    await act(async () => { archive.resolve(); expect(await resolution).toBe(true) })
    expect(result.current.pendingConflict).toBeNull()
    expect(result.current.editorState?.editor_doc).toEqual((choice === 'manual' ? snapshot('merged') : choice === 'local' ? local : remote).editor_doc)
    await act(() => result.current.flushSave())
    expect(save).toHaveBeenCalledTimes(choice === 'remote' ? 0 : 1)
  })
  it('ignores resolution completing after navigation while retaining the archive', async () => {
    await seed()
    const archive = deferred<void>()
    vi.spyOn(drafts, 'archiveMindMapEditorConflict').mockReturnValue(archive.promise)
    const { result, rerender, save } = setup()
    await waitFor(() => expect(result.current.pendingConflict).not.toBeNull())
    let resolution!: Promise<boolean>
    act(() => { resolution = result.current.resolveConflict({ ...result.current.pendingConflict!, choice: 'local' }) })
    await act(async () => { rerender({ id: 2 }) })
    await act(async () => { archive.resolve(); expect(await resolution).toBe(false) })
    expect(result.current.pendingConflict).toBeNull()
    expect(result.current.editorState).toEqual(remote)
    expect(save).not.toHaveBeenCalled()
  })
  it('fails closed without durable storage', async () => {
    await seed()
    const { result, save } = setup()
    await waitFor(() => expect(result.current.pendingConflict).not.toBeNull())
    const conflict = result.current.pendingConflict!
    await expect(result.current.resolveConflict({ ...conflict, choice: 'remote' })).rejects.toThrow('持久')
    expect(result.current.pendingConflict).not.toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
  it('rejects stale resolution after a newer local edit or owner change', async () => {
    await seed()
    vi.spyOn(drafts, 'archiveMindMapEditorConflict').mockResolvedValue()
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.pendingConflict).not.toBeNull())
    const stale = result.current.pendingConflict!
    act(() => result.current.setEditorState(snapshot('new local')))
    await act(async () => { expect(await result.current.resolveConflict({ ...stale, choice: 'remote' })).toBe(false) })
    const current = result.current.pendingConflict!
    await act(async () => { rerender({ id: 2 }) })
    await act(async () => { expect(await result.current.resolveConflict({ ...current, choice: 'remote' })).toBe(false) })
  })
  it('reloads a 409 remote snapshot without clobbering local or retrying', async () => {
    const load = vi.fn().mockResolvedValueOnce(snapshot('initial', 'r1')).mockResolvedValue(remote)
    const save = vi.fn(async () => { throw Object.assign(new Error('Conflict'), { status: 409 }) })
    const { result } = setup(load, save)
    await waitFor(() => expect(result.current.editorState).not.toBeNull())
    act(() => result.current.setEditorState(local))
    await act(() => result.current.flushSave())
    expect(result.current.pendingConflict).toMatchObject({ localSnapshot: local, remoteSnapshot: remote })
    expect(result.current.editorState).toEqual(local)
    await act(() => result.current.flushSave({ force: true }))
    expect(save).toHaveBeenCalledTimes(1)
  })
})
