import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/shared/api/http'
import { decodeArticleReadingResponse, getArticleReadingCursorApi, saveArticleReadingCursorApi } from './articleReadingApi'
vi.mock('@/shared/api/http', () => ({ request: vi.fn() }))
const snapshot = { owner_id: 'palace:1', cursor: null }
describe('article reading API', () => {
  beforeEach(() => vi.mocked(request).mockReset())
  it('reads with owner identity and skips offline replay for writes', async () => {
    vi.mocked(request).mockResolvedValue(snapshot)
    await getArticleReadingCursorApi('palace:1')
    expect(request).toHaveBeenCalledWith('/content/article-reading/palace%3A1', { signal: undefined })
    const payload = { node_uid: 'uid', client_id: 'tab', operation_id: 'op', client_sequence: 1, expected_revision: 0 }
    await saveArticleReadingCursorApi('palace:1', payload)
    expect(request).toHaveBeenLastCalledWith('/content/article-reading/palace%3A1', expect.objectContaining({ method: 'PUT', persistence: false, body: JSON.stringify(payload) }))
  })
  it('rejects stale owners and malformed snapshots', () => {
    expect(() => decodeArticleReadingResponse(snapshot, 'palace:2')).toThrow()
    expect(() => decodeArticleReadingResponse({ ...snapshot, cursor: {} }, 'palace:1')).toThrow()
    expect(decodeArticleReadingResponse(snapshot, 'palace:1')).toEqual(snapshot)
  })
})
