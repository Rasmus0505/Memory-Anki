import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as palaceApi from '@/modules/content/public'
import {
  fireEvent,
  getMindMapTexts,
  mockPalaceEditorResponse,
  renderPalaceEditPage,
  screen,
  setupPalaceEditPageTestDefaults,
  timedSessionMock,
  waitFor,
} from '@/pages/create/PalaceEditorPage.test-support'

describe('usePalaceEditPage inline practice mode', () => {
  beforeEach(() => {
    setupPalaceEditPageTestDefaults()
  })

  it('always re-enters the edit route in build mode even when learn was persisted', async () => {
    window.localStorage.setItem('memory-anki:mindmap-task:palace:101', 'learn')
    mockPalaceEditorResponse()

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
      expect(screen.getByRole('button', { name: '学习' })).toBeTruthy()
    })
    expect(window.localStorage.getItem('memory-anki:mindmap-task:palace:101')).toBe('build')
  })

  it('switches palace edit page into inline practice mode without changing layout or restarting the session', async () => {
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
      expect(screen.getByText('测试宫殿')).toBeTruthy()
    })

    await waitFor(() => {
      expect(palaceApi.getPracticeSessionProgressApi).toHaveBeenCalledWith(101)
    })

    expect(screen.getByText('学科与思维导图')).toBeTruthy()
    expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
    expect(screen.getByText('sync-soft-replace-edit:0:0:0-0-')).toBeTruthy()
    expect(screen.getByText('scope-palace-edit:101')).toBeTruthy()
    expect(screen.getByRole('button', { name: '转脑图' })).toBeTruthy()

    expect(screen.getByText('mindmap-mount-1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '学习' }))
    await waitFor(() => {
      expect(screen.getByText('学科与思维导图')).toBeTruthy()
      expect(screen.getByText('mindmap-practice-readonly-toolbar-preserve-import-sync')).toBeTruthy()
      expect(
        screen.getByText((content) =>
          content.startsWith('sync-soft-soft-edit:0:0:0-{"docFingerprint":'),
        ),
      ).toBeTruthy()
      expect(screen.getByText('scope-palace-edit:101')).toBeTruthy()
      expect(screen.getByText('flip-policies-auto-preserve')).toBeTruthy()
      expect(screen.getByRole('button', { name: '构建' })).toBeTruthy()
      // Same host instance — fullscreen/presentation state can survive mode switches.
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '构建' }))
    await waitFor(() => {
      expect(screen.getByText('学科与思维导图')).toBeTruthy()
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
      expect(screen.getByText('sync-soft-replace-edit:0:0:0-0-')).toBeTruthy()
      expect(screen.getByText('scope-palace-edit:101')).toBeTruthy()
      expect(screen.getByRole('button', { name: '学习' })).toBeTruthy()
      expect(screen.getByText('mindmap-mount-1')).toBeTruthy()
    })

    expect(palaceApi.getPracticeSessionProgressApi).toHaveBeenCalledTimes(1)
    expect(palaceApi.clearPracticeSessionProgressApi).not.toHaveBeenCalled()
  })

  it('keeps inline practice left-click flip behavior wired through the shared frame bridge', async () => {
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
          children: [
            {
              data: { text: '子节点', uid: 'child-1' },
              children: [{ data: { text: '孙节点', uid: 'grandchild-1' }, children: [] }],
            },
          ],
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

    fireEvent.click(screen.getByRole('button', { name: '学习' }))

    await waitFor(() => {
      expect(screen.getByText('mindmap-practice-readonly-toolbar-preserve-import-sync')).toBeTruthy()
    })
    expect(
      screen.getByText((content) =>
        content.startsWith('sync-soft-soft-edit:0:0:0-{"docFingerprint":'),
      ),
    ).toBeTruthy()
    expect(getMindMapTexts()).toEqual({
      root: 'root-测试宫殿',
      child: 'child-',
      grandchild: 'grandchild-',
    })

    fireEvent.click(screen.getByRole('button', { name: '点击根节点' }))
    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿',
        child: 'child-待回忆',
        grandchild: 'grandchild-',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿',
        child: 'child-子节点',
        grandchild: 'grandchild-',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿',
        child: 'child-子节点',
        grandchild: 'grandchild-待回忆',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '构建' }))
    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '学习' }))
    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿',
        child: 'child-子节点',
        grandchild: 'grandchild-待回忆',
      })
    })

    expect(timedSessionMock.registerActivity).toHaveBeenCalledWith('practice_interaction', {
      source: 'inline_practice_click',
    })
  })

  it('carries the current node focus across edit and practice mode switches', async () => {
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
          children: [
            {
              data: { text: '教育目的', uid: 'education-purpose' },
              children: [],
            },
          ],
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
    expect(screen.getByText('focus-:0')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '选中首子节点' }))
    fireEvent.click(screen.getByRole('button', { name: '学习' }))

    await waitFor(() => {
      expect(screen.getByText('mindmap-practice-readonly-toolbar-preserve-import-sync')).toBeTruthy()
      expect(screen.getByText('focus-education-purpose:1')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击根节点' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '点击首子节点' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    fireEvent.click(screen.getByRole('button', { name: '构建' }))

    await waitFor(() => {
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
      expect(screen.getByText('focus-education-purpose:2')).toBeTruthy()
    })
  })

  it('keeps inline practice right-click hide behavior wired through the shared frame bridge', async () => {
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
          children: [
            {
              data: { text: '子节点', uid: 'child-1' },
              children: [{ data: { text: '孙节点', uid: 'grandchild-1' }, children: [] }],
            },
          ],
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

    fireEvent.click(screen.getByRole('button', { name: '学习' }))

    await waitFor(() => {
      expect(screen.getByText('mindmap-practice-readonly-toolbar-preserve-import-sync')).toBeTruthy()
    })
    expect(
      screen.getByText((content) =>
        content.startsWith('sync-soft-soft-edit:0:0:0-{"docFingerprint":'),
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '点击根节点' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '点击首子节点' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))

    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿',
        child: 'child-子节点',
        grandchild: 'grandchild-待回忆',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '右键首子节点' }))

    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿',
        child: 'child-子节点',
        grandchild: 'grandchild-',
      })
    })

    expect(timedSessionMock.registerActivity).toHaveBeenCalledWith('practice_interaction', {
      source: 'inline_practice_contextmenu',
    })
  })
})
