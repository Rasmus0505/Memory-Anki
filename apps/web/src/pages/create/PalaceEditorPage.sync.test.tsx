import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/entities/palace/api'
import {
  fireEvent,
  renderPalaceEditPage,
  screen,
  setupPalaceEditPageTestDefaults,
  waitFor,
} from '@/pages/create/PalaceEditorPage.test-support'

describe('usePalaceEditPage sync and ai split behavior', () => {
  beforeEach(() => {
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
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '转脑图' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '覆盖当前脑图' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '覆盖当前脑图' }))

    expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
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
    expect(screen.getByText('sync-soft-replace-edit:0:0-0-')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存元信息' }))

    await waitFor(() => {
      expect(palaceApi.updatePalaceApi).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('sync-soft-replace-edit:0:0-0-')).toBeTruthy()
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
    expect(screen.getByText('sync-soft-replace-edit:0:0-0-')).toBeTruthy()

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
    expect(screen.getByText('sync-soft-replace-edit:1:0-0-')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '转脑图' }))

    await waitFor(() => {
      expect(screen.getByText('drawer-z-[130]-z-[120]')).toBeTruthy()
    })
  })

  it('applies ai split results into editor state while preserving the current view sync mode', async () => {
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
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
    })
    expect(screen.getByText('aisplit-idle')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'AI分卡' }))

    await waitFor(() => {
      expect(palaceApi.splitMindMapNodeApi).toHaveBeenCalledWith(101, expect.objectContaining({
        ai_options: {},
        owner_id: 'palace:101',
        split_mode: 'parallel',
        operation_id: expect.any(String),
        target_node_uid: 'node-1',
      }))
    })
    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-preserve-import-sync')).toBeTruthy()
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
      expect(screen.getByText('outline')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '切换半屏' }))

    await waitFor(() => {
      expect(screen.queryByText('outline')).toBeNull()
    })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByText('outline')).toBeTruthy()
    })
  })
})
