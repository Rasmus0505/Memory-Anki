import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as palaceApi from '@/shared/api/modules/palaces'
import {
  fireEvent,
  getMindMapTexts,
  mockPalaceEditorResponse,
  renderPalaceEditPage,
  screen,
  setupPalaceEditPageTestDefaults,
  timedSessionMock,
  waitFor,
} from '@/features/palace-edit/hooks/usePalaceEditPage.test-support'

describe('usePalaceEditPage mini palace mode', () => {
  beforeEach(() => {
    setupPalaceEditPageTestDefaults()
  })

  it('creates a mini palace from selected cards and practices it without entering inline practice', async () => {
    mockPalaceEditorResponse({
      root: {
        data: { text: '测试宫殿', uid: 'root-1' },
        children: [
          {
            data: { text: '子节点', uid: 'child-1' },
            children: [{ data: { text: '孙节点', uid: 'grandchild-1' }, children: [] }],
          },
        ],
      },
    })

    renderPalaceEditPage()

    await waitFor(() => {
      expect(screen.getByText('mini-palace-shown-idle-')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '小宫殿' }))

    await waitFor(() => {
      expect(palaceApi.getMiniPalacesApi).toHaveBeenCalledWith(101)
      expect(screen.getByRole('button', { name: '新建小宫殿' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '新建小宫殿' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-shown-selecting-')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '练习' })).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击根节点' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-shown-selecting-')).toBeTruthy()
      expect(screen.getByText('已选 0 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-shown-selecting-child-1')).toBeTruthy()
      expect(screen.getByText('已选 1 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '保存并进入' }))

    await waitFor(() => {
      expect(palaceApi.createMiniPalaceApi).toHaveBeenCalledWith(101, {
        name: '',
        node_uids: ['child-1'],
      })
      expect(screen.getByText('小宫殿翻卡')).toBeTruthy()
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿 / 小宫殿 1',
        child: 'child-待回忆',
        grandchild: 'grandchild-',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))

    await waitFor(() => {
      expect(screen.getByText('已完成')).toBeTruthy()
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿 / 小宫殿 1',
        child: 'child-子节点',
        grandchild: 'grandchild-孙节点',
      })
    })

    expect(timedSessionMock.registerActivity).toHaveBeenCalledWith('practice_interaction', {
      source: 'mini_palace_open',
    })
    expect(timedSessionMock.registerActivity).toHaveBeenCalledWith('practice_interaction', {
      source: 'mini_palace_flip_click',
    })
    expect(vi.mocked(palaceApi.clearPracticeSessionProgressApi)).not.toHaveBeenCalled()
  })
})
