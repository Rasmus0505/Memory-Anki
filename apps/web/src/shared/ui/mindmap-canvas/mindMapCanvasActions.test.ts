import { describe, expect, it, vi } from 'vitest'
import { Sparkles } from 'lucide-react'
import { buildNodeActions } from './mindMapCanvasActions'

function buildActions(overrides: Partial<Parameters<typeof buildNodeActions>[0]> = {}) {
  return buildNodeActions({
    ctxMenu: { x: 12, y: 18, nodeId: 'child', targetNodeIds: ['child'] },
    readonly: false,
    onAddChild: vi.fn(),
    onAddSibling: vi.fn(),
    onDelete: vi.fn(),
    onDeleteNodeOnly: vi.fn(),
    onHighlightNodes: vi.fn(),
    onStartEdit: vi.fn(),
    isRootNode: () => false,
    getSubtreeSize: () => 3,
    ...overrides,
  })
}

describe('mind map node context actions', () => {
  it('keeps structural actions when page-specific actions are supplied', () => {
    const customAction = {
      label: 'AI 拆分知识点',
      icon: Sparkles,
      onClick: vi.fn(),
    }
    const actions = buildActions({ buildCustomNodeActions: () => [customAction] })

    expect(actions.map((action) => action.label)).toEqual([
      '添加子知识点 (Tab)',
      '添加同级知识点 (Shift+Enter)',
      '上移',
      '下移',
      '编辑文字 (Enter / F2)',
      '标记重点',
      '单独删除（保留子级）',
      '删除整条分支（3 张卡片）',
      'AI 拆分知识点',
    ])
    expect(actions.at(-1)?.separatorBefore).toBe(true)
  })

  it('protects the root from sibling, move, and delete actions', () => {
    const actions = buildActions({ isRootNode: () => true })

    expect(actions.map((action) => action.label)).toEqual([
      '添加子知识点 (Tab)',
      '编辑文字 (Enter / F2)',
      '标记重点',
    ])
  })

  it('toggles question-card labels for multi-select targets', () => {
    const onToggleQuestionCards = vi.fn()
    const setActions = buildActions({
      ctxMenu: {
        x: 12,
        y: 18,
        nodeId: 'child-a',
        targetNodeIds: ['child-a', 'child-b'],
      },
      onToggleQuestionCards,
      isQuestionCard: () => false,
      isRootNode: (id) => id === 'root',
    })
    const setAction = setActions.find((action) => action.label === '设置为题目卡（2 张）')
    expect(setAction).toBeTruthy()
    setAction?.onClick()
    expect(onToggleQuestionCards).toHaveBeenCalledWith(['child-a', 'child-b'], true)

    const clearActions = buildActions({
      ctxMenu: {
        x: 12,
        y: 18,
        nodeId: 'child-a',
        targetNodeIds: ['child-a', 'child-b'],
      },
      onToggleQuestionCards,
      isQuestionCard: () => true,
      isRootNode: (id) => id === 'root',
    })
    const clearAction = clearActions.find((action) => action.label === '取消题目卡（2 张）')
    expect(clearAction).toBeTruthy()
    clearAction?.onClick()
    expect(onToggleQuestionCards).toHaveBeenCalledWith(['child-a', 'child-b'], false)
  })

  it('keeps only contextual page actions in readonly modes', () => {
    const actions = buildActions({
      readonly: true,
      buildCustomNodeActions: () => [{ label: '隐藏这个分支', icon: Sparkles, onClick: vi.fn() }],
    })

    expect(actions.map((action) => action.label)).toEqual(['隐藏这个分支'])
  })

  it('applies multi-select highlight and delete to all target node ids', () => {
    const onHighlightNodes = vi.fn()
    const onDeleteNodes = vi.fn()
    const onDelete = vi.fn()
    const actions = buildActions({
      ctxMenu: {
        x: 12,
        y: 18,
        nodeId: 'child-a',
        targetNodeIds: ['child-a', 'child-b', 'child-c'],
      },
      onHighlightNodes,
      onDeleteNodes,
      onDelete,
      isRootNode: (id) => id === 'root',
    })

    expect(actions.map((action) => action.label)).toEqual([
      '标记重点（3 张）',
      '删除选中（3 处）',
    ])

    actions.find((action) => action.label === '标记重点（3 张）')?.onClick()
    expect(onHighlightNodes).toHaveBeenCalledWith(['child-a', 'child-b', 'child-c'])

    actions.find((action) => action.label === '删除选中（3 处）')?.onClick()
    expect(onDeleteNodes).toHaveBeenCalledWith(['child-a', 'child-b', 'child-c'])
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('excludes root from multi-select delete targets', () => {
    const onDeleteNodes = vi.fn()
    const onDelete = vi.fn()
    const actions = buildActions({
      ctxMenu: {
        x: 12,
        y: 18,
        nodeId: 'child',
        targetNodeIds: ['root', 'child'],
      },
      onDeleteNodes,
      onDelete,
      isRootNode: (id) => id === 'root',
    })

    // Root is excluded; only one non-root remains → single delete path.
    const deleteAction = actions.find((action) => action.label.includes('删除'))
    expect(deleteAction?.label).toBe('删除选中（1 处）')
    deleteAction?.onClick()
    expect(onDelete).toHaveBeenCalledWith('child')
    expect(onDeleteNodes).not.toHaveBeenCalled()
  })
})
