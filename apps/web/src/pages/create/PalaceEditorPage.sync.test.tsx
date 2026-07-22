import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/modules/content/public'
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
    expect(screen.getByText('sync-soft-replace-edit:0:0:0-0-')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存元信息' }))

    await waitFor(() => {
      expect(palaceApi.updatePalaceApi).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })
    expect(screen.getByText('sync-soft-replace-edit:0:0:0-0-')).toBeTruthy()
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
    expect(screen.getByText('sync-soft-replace-edit:0:0:0-0-')).toBeTruthy()

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
    expect(screen.getByText('sync-soft-replace-edit:1:0:0-0-')).toBeTruthy()
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

  it('opens AI split workbench, previews without writing, then applies replace into editor state', async () => {
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
    expect(screen.getByText('child-原节点')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'AI分卡' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI 分卡工作台' })).toBeTruthy()
    })
    // Opening workbench must not call API or mutate editor yet.
    expect(palaceApi.splitMindMapNodeApi).not.toHaveBeenCalled()
    expect(screen.getByText('child-原节点')).toBeTruthy()

    // Catalog load finishes async; wait until generate is enabled.
    await waitFor(() => {
      const start = screen.getByRole('button', { name: '开始分卡' }) as HTMLButtonElement
      expect(start.disabled).toBe(false)
    })
    expect(screen.getByText('自动判断（推荐）')).toBeTruthy()
    expect(screen.getByText('并列卡大约几张')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '开始分卡' }))

    await waitFor(() => {
      expect(palaceApi.splitMindMapNodeApi).toHaveBeenCalledWith(101, expect.objectContaining({
        owner_id: 'palace:101',
        split_mode: 'auto',
        target_card_count: null,
        operation_id: expect.any(String),
        target_node_uid: 'node-1',
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '替换原卡片' })).toBeTruthy()
    })
    // Still not written until apply.
    expect(screen.getByText('child-原节点')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '替换原卡片' }))

    await waitFor(() => {
      expect(screen.getByText('child-AI分类')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-preserve-import-sync')).toBeTruthy()
    })
    expect(screen.getByText(/sync-soft-replace-edit:0:0:1/)).toBeTruthy()
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
