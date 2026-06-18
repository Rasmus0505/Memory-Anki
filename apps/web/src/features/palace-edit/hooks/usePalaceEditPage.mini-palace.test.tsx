import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as miniPalaceApi from '@/entities/mini-palace/api'
import * as palaceApi from '@/entities/palace/api'
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

  it('prefills the mini palace name from the currently selected node', async () => {
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
      expect(screen.getByText('mini-palace-idle-')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '选中首子节点' }))
    fireEvent.click(screen.getByRole('button', { name: '小宫殿' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新建小宫殿' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '新建小宫殿' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('子节点')).toBeTruthy()
    })
  })

  it('does not prefill the root node name when the root is selected', async () => {
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
      expect(screen.getByText('mini-palace-idle-')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '选中根节点' }))
    fireEvent.click(screen.getByRole('button', { name: '小宫殿' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新建小宫殿' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '新建小宫殿' }))

    await waitFor(() => {
      const input = screen.getByPlaceholderText('不填则使用默认名字') as HTMLInputElement
      expect(input.value).toBe('')
    })
  })

  it('creates a mini palace from selected cards and practices it without entering inline practice', async () => {
    vi.mocked(miniPalaceApi.createMiniPalaceApi).mockResolvedValueOnce({
      item: {
        id: 1,
        palace_id: 101,
        name: '子节点',
        node_uids: ['child-1'],
        node_count: 1,
        sort_order: 0,
        created_at: null,
        updated_at: null,
        is_empty: false,
        estimated_review_seconds: 0,
        review_stage_total: 0,
        review_stage_completed: 0,
        review_stage_progress: 0,
        stage_labels: [],
        review_stages: [],
        next_review_at: null,
        has_due_review: false,
        current_review_schedule_id: null,
        current_review_type: null,
      },
    } as never)

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
      expect(screen.getByText('mini-palace-idle-')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '小宫殿' }))

    await waitFor(() => {
      expect(miniPalaceApi.getMiniPalacesApi).toHaveBeenCalledWith(101)
      expect(screen.getByRole('button', { name: '新建小宫殿' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '新建小宫殿' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '练习' })).toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击根节点' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-')).toBeTruthy()
      expect(screen.getByText('已选 0 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-child-1')).toBeTruthy()
      expect(screen.getByText('已选 1 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '确认新建小宫殿' }))

    await waitFor(() => {
      expect(miniPalaceApi.createMiniPalaceApi).toHaveBeenCalledWith(101, {
        name: '',
        node_uids: ['child-1'],
      })
      expect(screen.getByText('小宫殿翻卡')).toBeTruthy()
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿 / 子节点',
        child: 'child-待回忆',
        grandchild: 'grandchild-',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))

    await waitFor(() => {
      expect(screen.getByText('已完成')).toBeTruthy()
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿 / 子节点',
        child: 'child-子节点',
        grandchild: 'grandchild-',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))

    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿 / 子节点',
        child: 'child-子节点',
        grandchild: 'grandchild-待回忆',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首孙节点' }))

    await waitFor(() => {
      expect(getMindMapTexts()).toEqual({
        root: 'root-测试宫殿 / 子节点',
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

  it('edits an existing mini palace by toggling nodes and saving the updated selection', async () => {
    vi.mocked(miniPalaceApi.getMiniPalacesApi).mockResolvedValueOnce({
      items: [
        {
          id: 1,
          palace_id: 101,
          name: '旧小宫殿',
          node_uids: ['child-1'],
          node_count: 1,
          sort_order: 0,
          created_at: null,
          updated_at: null,
          is_empty: false,
          estimated_review_seconds: 0,
          review_stage_total: 0,
          review_stage_completed: 0,
          review_stage_progress: 0,
          stage_labels: [],
          review_stages: [],
          next_review_at: null,
          has_due_review: false,
          current_review_schedule_id: null,
          current_review_type: null,
        },
      ],
    } as never)
    vi.mocked(miniPalaceApi.updateMiniPalaceApi).mockResolvedValueOnce({
      item: {
        id: 1,
        palace_id: 101,
        name: '旧小宫殿',
        node_uids: ['child-1', 'grandchild-1'],
        node_count: 2,
        sort_order: 0,
        created_at: null,
        updated_at: null,
        is_empty: false,
        estimated_review_seconds: 0,
        review_stage_total: 0,
        review_stage_completed: 0,
        review_stage_progress: 0,
        stage_labels: [],
        review_stages: [],
        next_review_at: null,
        has_due_review: false,
        current_review_schedule_id: null,
        current_review_type: null,
      },
    } as never)

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
      expect(screen.getByText('mini-palace-idle-')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '小宫殿' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-child-1')).toBeTruthy()
      expect(screen.getByText('已选 1 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-')).toBeTruthy()
      expect(screen.getByText('已选 0 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '点击首子节点' }))
    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-child-1')).toBeTruthy()
      expect(screen.getByText('已选 1 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '右键首子节点' }))
    await waitFor(() => {
      expect(screen.getByText('mini-palace-selecting-child-1,grandchild-1')).toBeTruthy()
      expect(screen.getByText('已选 2 张')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '保存小宫殿' }))

    await waitFor(() => {
      expect(miniPalaceApi.updateMiniPalaceApi).toHaveBeenCalledWith(1, {
        name: '旧小宫殿',
        node_uids: ['child-1', 'grandchild-1'],
      })
    })
  })
})
