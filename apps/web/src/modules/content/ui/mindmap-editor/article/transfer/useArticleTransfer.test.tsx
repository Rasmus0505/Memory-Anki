import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useArticleTransfer, type ArticleTransferHostPort } from './useArticleTransfer'
import { applyArticleTransfer, collectArticlePackageExport } from '@/modules/content/application/articleTransfer'
vi.mock('@/modules/content/application/articleTransfer', async (original) => ({ ...await original<typeof import('@/modules/content/application/articleTransfer')>(), applyArticleTransfer: vi.fn(), collectArticlePackageExport: vi.fn() }))
const document = { schemaVersion: 1 as const, root: { data: { uid: 'root', text: 'Article' } } }
function host(): ArticleTransferHostPort {
  return { ownerId: 'palace:1', readHost: () => ({ ownerId: 'palace:1', palaceId: 1, document, revision: 'r1', dirty: false }), flushSave: vi.fn().mockResolvedValue(undefined), onApplied: vi.fn(), pendingConflict: false, selectedUid: 'root' }
}
const file = () => ({ name: 'article.md', size: 20, text: async () => '# Imported\n\nBody' }) as File
beforeEach(() => vi.clearAllMocks())
describe('article transfer controller', () => {
  it('previews without saving and flushes before applying to selected UID', async () => {
    const port = host()
    const { result } = renderHook(() => useArticleTransfer(port))
    await act(() => result.current.loadFile(file()))
    expect(port.flushSave).not.toHaveBeenCalled()
    expect(applyArticleTransfer).not.toHaveBeenCalled()
    vi.mocked(applyArticleTransfer).mockResolvedValue({ stale: false, result: { palace_id: 1 } as never })
    await act(() => result.current.apply({ mode: 'append', parentUid: 'root' }))
    expect(port.flushSave).toHaveBeenCalledOnce()
    expect(applyArticleTransfer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerId: 'palace:1', revision: 'r1', dirty: false }), { mode: 'append', parentUid: 'root' }, expect.any(Function))
    expect(port.onApplied).toHaveBeenCalledOnce()
  })
  it('captures the newly saved revision after flush, never the rendered preview revision', async () => {
    const port = host()
    let revision = 'r1'
    port.readHost = () => ({ ownerId: port.ownerId, palaceId: 1, document, revision, dirty: false })
    port.flushSave = vi.fn(async () => { revision = 'r2' })
    vi.mocked(applyArticleTransfer).mockResolvedValue({ stale: false, result: { palace_id: 1 } as never })
    const { result } = renderHook(() => useArticleTransfer(port))
    await act(() => result.current.loadFile(file()))
    await act(() => result.current.apply({ mode: 'replace', confirmReplace: true }))
    expect(applyArticleTransfer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ revision: 'r2' }), expect.anything(), expect.any(Function))
  })
  it('blocks all transfers while conflict is pending', async () => {
    const port = { ...host(), pendingConflict: true }
    const { result } = renderHook(() => useArticleTransfer(port))
    await act(() => result.current.loadFile(file()))
    await act(() => result.current.exportFile(true))
    expect(result.current.input).toBeNull()
    expect(port.flushSave).not.toHaveBeenCalled()
  })
  it('surfaces missing export resources rather than downloading incomplete ZIP', async () => {
    vi.mocked(collectArticlePackageExport).mockRejectedValue(new Error('附件读取失败 (404)'))
    const { result } = renderHook(() => useArticleTransfer(host()))
    await act(() => result.current.exportFile(true))
    expect(result.current.error).toContain('附件读取失败')
  })
  it('does not hydrate after a stale response', async () => {
    const port = host()
    vi.mocked(applyArticleTransfer).mockResolvedValue({ stale: true, result: { palace_id: 1 } as never })
    const { result } = renderHook(() => useArticleTransfer(port))
    await act(() => result.current.loadFile(file()))
    await act(() => result.current.apply({ mode: 'create' }))
    expect(port.onApplied).not.toHaveBeenCalled()
    expect(result.current.error).toContain('勿重复提交')
  })
  it('discards late file preview after owner changes', async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>((done) => { resolve = done })
    const port = host()
    const { result, rerender } = renderHook((value) => useArticleTransfer(value), { initialProps: port })
    let task!: Promise<void>
    act(() => { task = result.current.loadFile({ ...file(), text: () => pending } as File) })
    rerender({ ...port, ownerId: 'palace:2' })
    await act(async () => { resolve('# Late'); await task })
    await waitFor(() => expect(result.current.input).toBeNull())
  })
})
