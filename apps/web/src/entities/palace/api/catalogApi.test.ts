import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAttachmentUrl,
  createPalaceApi,
  createPalaceTemplateApi,
  deleteAttachmentApi,
  deletePalaceTemplateApi,
  getPalacesApi,
  getPalacesGroupedApi,
  getPalacesGroupedSummaryApi,
  invalidatePalaceCatalogCache,
  instantiatePalaceTemplateApi,
  listPalaceTemplatesApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
  prefetchPalacesGroupedApi,
  prefetchPalacesGroupedSummaryApi,
  uploadAttachmentApi,
} from './catalogApi'
import { clearPromiseWarmupCacheForTest } from '@/shared/api/promiseWarmupCache'

const { requestMock, uploadWithFormDataMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  uploadWithFormDataMock: vi.fn(),
}))

vi.mock('@/shared/api/http', () => ({
  API_BASE: 'https://api.example.test/api/v1',
  request: requestMock,
  uploadWithFormData: uploadWithFormDataMock,
}))

describe('palace catalog api', () => {
  afterEach(() => {
    vi.clearAllMocks()
    clearPromiseWarmupCacheForTest()
  })

  it('builds attachment and list endpoints with encoded query params', async () => {
    requestMock.mockResolvedValueOnce([{ id: 1 }])

    expect(buildAttachmentUrl(42)).toBe('https://api.example.test/api/v1/attachments/42')
    await expect(getPalacesApi({ scope: 'due today', subject: '英语' })).resolves.toEqual([
      { id: 1 },
    ])

    expect(requestMock).toHaveBeenCalledWith('/palaces?scope=due+today&subject=%E8%8B%B1%E8%AF%AD')
  })

  it('consumes a prefetched grouped list without issuing a second request', async () => {
    requestMock.mockResolvedValueOnce({ items: [{ id: 1, title: 'Memory Palace' }] })

    prefetchPalacesGroupedApi({ scope: 'recent' })

    await expect(getPalacesGroupedApi({ scope: 'recent' })).resolves.toEqual({
      items: [{ id: 1, title: 'Memory Palace' }],
    })
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('/palaces/grouped?scope=recent')
  })

  it('invalidates warmed catalog responses and dispatches the catalog event', async () => {
    const events: Event[] = []
    const onInvalidated = (event: Event) => events.push(event)
    window.addEventListener(PALACE_CATALOG_INVALIDATED_EVENT, onInvalidated)
    requestMock
      .mockResolvedValueOnce({ items: [{ id: 'warmed' }] })
      .mockResolvedValueOnce({ items: [{ id: 'fresh' }] })

    prefetchPalacesGroupedSummaryApi({ limit: '5' })
    invalidatePalaceCatalogCache()

    await expect(getPalacesGroupedSummaryApi({ limit: '5' })).resolves.toEqual({
      items: [{ id: 'fresh' }],
    })

    expect(events).toHaveLength(1)
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(requestMock).toHaveBeenLastCalledWith('/palaces/grouped-summary?limit=5')
    window.removeEventListener(PALACE_CATALOG_INVALIDATED_EVENT, onInvalidated)
  })

  it('sends persistence metadata for catalog mutations', async () => {
    requestMock.mockResolvedValueOnce({ ok: true })

    await createPalaceApi({ title: 'New palace' })

    expect(requestMock).toHaveBeenNthCalledWith(1, '/palaces', {
      method: 'POST',
      body: JSON.stringify({ title: 'New palace' }),
      persistence: {
        resourceKey: 'palace:create:New palace',
        description: '创建宫殿',
        replayMode: 'manual',
      },
    })
  })

  it('uses palace template endpoints', async () => {
    requestMock
      .mockResolvedValueOnce({ items: [{ id: 2, name: '房间桩' }] })
      .mockResolvedValueOnce({ item: { id: 2, name: '房间桩' } })
      .mockResolvedValueOnce({ id: 9 })
      .mockResolvedValueOnce({ ok: true })

    await listPalaceTemplatesApi()
    await createPalaceTemplateApi({ palace_id: 7, name: '房间桩', description: '常用' })
    await instantiatePalaceTemplateApi(2, '解剖学第3章')
    await deletePalaceTemplateApi(2)

    expect(requestMock).toHaveBeenNthCalledWith(1, '/palace-templates')
    expect(requestMock).toHaveBeenNthCalledWith(2, '/palace-templates', {
      method: 'POST',
      body: JSON.stringify({ palace_id: 7, name: '房间桩', description: '常用' }),
      persistence: {
        resourceKey: 'palace-template:create',
        description: '存为宫殿模板',
        replayMode: 'manual',
      },
    })
    expect(requestMock).toHaveBeenNthCalledWith(3, '/palace-templates/2/instantiate', {
      method: 'POST',
      body: JSON.stringify({ title: '解剖学第3章' }),
      persistence: {
        resourceKey: 'palace-template:instantiate',
        description: '从模板创建宫殿',
        replayMode: 'manual',
      },
    })
    expect(requestMock).toHaveBeenNthCalledWith(4, '/palace-templates/2', {
      method: 'DELETE',
      persistence: {
        resourceKey: 'palace-template:delete:2',
        description: '删除宫殿模板',
        replayMode: 'manual',
      },
    })
  })

  it('uploads and deletes attachments through the catalog endpoints', async () => {
    const file = new File(['image'], 'cover.png', { type: 'image/png' })
    uploadWithFormDataMock.mockResolvedValueOnce({ id: 3, filename: 'cover.png' })
    requestMock.mockResolvedValueOnce({ ok: true })

    await uploadAttachmentApi(9, file)
    await deleteAttachmentApi(3)

    const [, formData, uploadOptions] = uploadWithFormDataMock.mock.calls[0]
    expect(uploadWithFormDataMock).toHaveBeenCalledWith(
      '/palaces/9/upload',
      expect.any(FormData),
      {
        resourceKey: 'palace:9:attachment:cover.png',
        description: '上传附件：cover.png',
      },
    )
    expect(formData.get('file')).toBe(file)
    expect(uploadOptions.resourceKey).toBe('palace:9:attachment:cover.png')
    expect(requestMock).toHaveBeenCalledWith('/attachments/3', {
      method: 'DELETE',
      persistence: {
        resourceKey: 'attachment:3:delete',
        description: '删除附件',
        replayMode: 'manual',
      },
    })
  })
})
