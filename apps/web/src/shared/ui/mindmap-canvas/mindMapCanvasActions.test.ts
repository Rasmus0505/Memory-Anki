import { describe, expect, it, vi } from 'vitest'
import { Sparkles } from 'lucide-react'
import { buildNodeActions } from './mindMapCanvasActions'

function buildActions(overrides: Partial<Parameters<typeof buildNodeActions>[0]> = {}) {
  return buildNodeActions({
    ctxMenu: { x: 12, y: 18, nodeId: 'child' },
    readonly: false,
    onAddChild: vi.fn(),
    onAddSibling: vi.fn(),
    onDelete: vi.fn(),
    onDeleteNodeOnly: vi.fn(),
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
    ])
  })

  it('keeps only contextual page actions in readonly modes', () => {
    const actions = buildActions({
      readonly: true,
      buildCustomNodeActions: () => [{ label: '隐藏这个分支', icon: Sparkles, onClick: vi.fn() }],
    })

    expect(actions.map((action) => action.label)).toEqual(['隐藏这个分支'])
  })
})
