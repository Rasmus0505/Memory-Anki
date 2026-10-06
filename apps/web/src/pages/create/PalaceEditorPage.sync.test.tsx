import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/modules/content/domain/palace-entity/api'
import { resetMindMapEditorDraftStoreForTest } from '@/shared/persistence/mindmapEditorDraftStore'
import {
  fireEvent,
  renderPalaceEditPage,
  screen,
  setupPalaceEditPageTestDefaults,
  waitFor,
} from '@/pages/create/PalaceEditorPage.test-support'

describe('usePalaceEditPage sync behavior', () => {
  beforeEach(async () => {
    // Every case reuses palace 101 with a different server fixture; drafts are independent state.
    await resetMindMapEditorDraftStoreForTest()
    setupPalaceEditPageTestDefaults()
  })

  it('forces a preserve-view sync after import apply in edit mode', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [{ data: { text: '原节点', uid: 'node-1' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-preserve-import-sync')).toBeTruthy()
    })

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('{"root":{"data":{"text":"导入"},"children":[]}}') },
    })
    fireEvent.click(await screen.findByRole('button', { name: '文字转脑图' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '覆盖当前脑图' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '覆盖当前脑图' }))

    expect(screen.getByText('mindmap-edit-editable-plain-preserve-import-sync')).toBeTruthy()
  })

  it('keeps the same mind map host instance when saving meta and only uses soft sync props', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('sync-soft-soft-edit:0:0-0-')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存元信息' }))

    await waitFor(() => {
      expect(palaceApi.updatePalaceApi).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('sync-soft-soft-edit:0:0-0-')).toBeTruthy()
  })

  it('keeps the same mind map host instance and bumps replace sync key after restore version', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: { root: { data: { text: '测试宫殿', uid: 'root-1' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('sync-soft-soft-edit:0:0-0-')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '恢复点' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '恢复版本1' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '恢复版本1' }))

    await waitFor(() => {
      expect(palaceApi.restorePalaceVersionApi).toHaveBeenCalledWith(101, 1)
    })
    await waitFor(() => {
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('sync-soft-soft-edit:1:0-0-')).toBeTruthy()
  })

  it('raises the import drawer above the immersive card when fullscreen is active', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [{ data: { text: '原节点', uid: 'node-1' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('测试宫殿')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '切换半屏' }))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue('{"root":{"data":{"text":"导入"},"children":[]}}') },
    })
    fireEvent.click(await screen.findByRole('button', { name: '文字转脑图' }))

    await waitFor(() => {
      expect(screen.getByText('drawer-z-[130]-z-[120]')).toBeTruthy()
    })
  })

  it('exits immersive mode on Escape regardless of practice or edit mode shell state', async () => {
    vi.spyOn(palaceApi, 'getPalaceEditorApi').mockResolvedValue({
      palace: {
        id: 101,
        title: '测试宫殿',
        description: '',
        created_at: null,
        attachments: [],
        chapters: [],
      },
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [{ data: { text: '原节点', uid: 'node-1' }, children: [] }],
        },
      },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    } as never)

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('学科与思维导图')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '切换半屏' }))

    await waitFor(() => {
      expect(screen.queryByText('学科与思维导图')).toBeNull()
    })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByText('学科与思维导图')).toBeTruthy()
    })
  })
})
