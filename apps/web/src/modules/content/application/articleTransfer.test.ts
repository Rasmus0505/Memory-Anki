import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyArticleTransfer, collectArticlePackageExport, compareArticleTransfer, type ArticleTransferHost } from './articleTransfer'
import { getArticlePackageSourceApi, transferArticleApi } from '../api/articlePackageApi'

vi.mock('../api/articlePackageApi', () => ({ ARTICLE_QUIZ_FORMAT: 'memory-anki-article-quiz-v1', transferArticleApi: vi.fn(), getArticlePackageSourceApi: vi.fn(), fetchArticleAssetApi: vi.fn() }))
vi.mock('../domain/palace-entity/api/catalogApi', () => ({ invalidatePalaceCatalogCache: vi.fn() }))
const document = { schemaVersion: 1 as const, root: { data: { uid: 'root', text: 'Title' }, children: [{ data: { uid: 'child', text: 'Content' } }] } }
function host(): ArticleTransferHost { return { ownerId: 'palace:1', operationId: 'op', palaceId: 1, revision: 'rev', document, dirty: false } }

beforeEach(() => vi.clearAllMocks())
describe('article transfer bridge', () => {
  it('requires same source owner and exact revision for update', () => {
    expect(compareArticleTransfer({ document, manifest: { sourceOwner: 'palace:1', baseRevision: 'rev' } }, host()).canUpdate).toBe(true)
    expect(compareArticleTransfer({ document, manifest: { sourceOwner: 'palace:2', baseRevision: 'rev' } }, host()).canUpdate).toBe(false)
    expect(compareArticleTransfer({ document, manifest: { sourceOwner: 'palace:1', baseRevision: null } }, host()).canUpdate).toBe(false)
  })
  it('preserves dirty shared drafts and requires explicit replace confirmation', async () => {
    const dirty = { ...host(), dirty: true }
    await expect(applyArticleTransfer({ document }, dirty, { mode: 'replace', confirmReplace: true }, () => dirty)).rejects.toThrow('草稿')
    await expect(applyArticleTransfer({ document }, host(), { mode: 'replace' }, host)).rejects.toThrow('确认')
    expect(transferArticleApi).not.toHaveBeenCalled()
  })
  it('rejects unsupported quiz formats instead of losing bindings', async () => {
    await expect(applyArticleTransfer({ document, quiz: { format: 'whole-db', data: {} } }, host(), { mode: 'create' }, host)).rejects.toThrow('题目')
    expect(transferArticleApi).not.toHaveBeenCalled()
  })
  it('marks late completion stale without applying to another owner', async () => {
    const captured = host()
    let current = captured
    vi.mocked(transferArticleApi).mockImplementation(async () => {
      current = { ...captured, ownerId: 'palace:2' }
      return { palace_id: 1, owner_id: captured.ownerId, operation_id: captured.operationId, editor_doc: document, editor_fingerprint: 'next', uid_map: {}, snapshot: { schemaVersion: 1, document, revision: 'next', editorPreferences: {}, localPreferences: {}, language: 'zh' } }
    })
    const response = await applyArticleTransfer({ document }, captured, { mode: 'append', parentUid: 'root' }, () => current)
    expect(response.stale).toBe(true)
    expect(transferArticleApi).toHaveBeenCalledWith(1, expect.objectContaining({ expected_revision: 'rev', operation_id: 'op', parent_uid: 'root' }))
  })
  it('does not export a server snapshot different from the captured revision', async () => {
    vi.mocked(getArticlePackageSourceApi).mockResolvedValue({ document, source_owner: 'palace:1', base_revision: 'remote', quiz: {} })
    await expect(collectArticlePackageExport(1, 'rev')).rejects.toThrow('版本')
  })
})
