import { beforeEach, describe, expect, it } from 'vitest'
import * as palaceApi from '@/shared/api/modules/palaces'
import {
  fireEvent,
  getMindMapTexts,
  renderPalaceEditPage,
  screen,
  setupPalaceEditPageTestDefaults,
  timedSessionMock,
  waitFor,
} from '@/features/palace-edit/hooks/usePalaceEditPage.test-support'

describe('usePalaceEditPage inline practice mode', () => {
  beforeEach(() => {
    setupPalaceEditPageTestDefaults()
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

    expect(screen.getByText('outline')).toBeTruthy()
    expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
    expect(screen.getByText('sync-soft-replace-edit:0:0-0-')).toBeTruthy()
    expect(screen.getByText('scope-palace-edit:101:edit')).toBeTruthy()
    expect(screen.getByRole('button', { name: '转脑图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '转文字' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '练习' }))
    await waitFor(() => {
      expect(screen.getByText('outline')).toBeTruthy()
      expect(screen.getByText('mindmap-practice-readonly-toolbar-reset-import-sync')).toBeTruthy()
      expect(
        screen.getByText((content) =>
          content.startsWith('sync-replace-replace-practice:0:0-{"docFingerprint":'),
        ),
      ).toBeTruthy()
      expect(screen.getByText('scope-palace-edit:101:practice')).toBeTruthy()
      expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await waitFor(() => {
      expect(screen.getByText('outline')).toBeTruthy()
      expect(screen.getByText('mindmap-edit-editable-plain-reset-import-sync')).toBeTruthy()
      expect(screen.getByText('sync-soft-replace-edit:0:0-0-')).toBeTruthy()
      expect(screen.getByText('scope-palace-edit:101:edit')).toBeTruthy()
      expect(screen.getByRole('button', { name: '练习' })).toBeTruthy()
    })

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

    fireEvent.click(screen.getByRole('button', { name: '练习' }))

    await waitFor(() => {
      expect(screen.getByText('mindmap-practice-readonly-toolbar-reset-import-sync')).toBeTruthy()
    })
    expect(
      screen.getByText((content) =>
        content.startsWith('sync-replace-replace-practice:0:0-{"docFingerprint":'),
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

    expect(timedSessionMock.registerActivity).toHaveBeenCalledWith('practice_interaction', {
      source: 'inline_practice_click',
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

    fireEvent.click(screen.getByRole('button', { name: '练习' }))

    await waitFor(() => {
      expect(screen.getByText('mindmap-practice-readonly-toolbar-reset-import-sync')).toBeTruthy()
    })
    expect(
      screen.getByText((content) =>
        content.startsWith('sync-replace-replace-practice:0:0-{"docFingerprint":'),
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '点击根节点' }))
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
