import { describe, expect, it } from 'vitest'
import { applyMindMapLayout, getNodeSize } from './layout'
import type { GraphData } from './adapter'

describe('mind map layout sizing', () => {
  it('grows node height for long labels', () => {
    const shortSize = getNodeSize('branch', '短节点')
    const longSize = getNodeSize(
      'branch',
      '路德提出应由国家普及义务教育，实施强迫义务教育。加尔文要求国家开办公立学校，实行免费教育；使所有儿童都有机会受到教育。',
    )

    expect(longSize.width).toBe(shortSize.width)
    expect(longSize.height).toBeGreaterThan(shortSize.height)
  })

  it('grows node height for explicit line breaks', () => {
    const singleLine = getNodeSize('leaf', '第一行')
    const multiLine = getNodeSize('leaf', '第一行\n第二行\n第三行')

    expect(multiLine.height).toBeGreaterThan(singleLine.height)
  })

  it('keeps sibling nodes vertically separated when labels wrap', () => {
    const graphData: GraphData = {
      nodes: [
        {
          id: 'root',
          type: 'peg',
          label: '主题',
          originalId: 1,
          parentId: null,
          metadata: {},
        },
        {
          id: 'child-a',
          type: 'peg',
          label:
            '路德提出应由国家普及义务教育，实施强迫义务教育。加尔文要求国家开办公立学校，实行免费教育；使所有儿童都有机会受到教育。',
          originalId: 2,
          parentId: 'root',
          metadata: {},
        },
        {
          id: 'child-b',
          type: 'peg',
          label: '短节点',
          originalId: 3,
          parentId: 'root',
          metadata: {},
        },
      ],
      edges: [
        { id: 'root->child-a', source: 'root', target: 'child-a', type: 'parent-child' },
        { id: 'root->child-b', source: 'root', target: 'child-b', type: 'parent-child' },
      ],
    }

    const { nodes } = applyMindMapLayout(graphData)
    const siblings = nodes
      .filter((node) => node.id === 'child-a' || node.id === 'child-b')
      .sort((a, b) => a.position.y - b.position.y)
    const [topNode, bottomNode] = siblings
    const topSize = getNodeSize(topNode)

    expect(siblings).toHaveLength(2)
    expect(bottomNode.position.y).toBeGreaterThanOrEqual(topNode.position.y + topSize.height + 8)
  })

  it('keeps multiple long-text children separated by the minimum visual gap', () => {
    const longLabel =
      '这是一段非常长的文本，用于测试节点高度估算和碰撞检测的正确性，包含中文内容以模拟实际使用场景，确保多个长文本节点连续排列时不会出现遮挡。'
    const graphData: GraphData = {
      nodes: [
        {
          id: 'root',
          type: 'peg',
          label: '长文本重叠测试',
          originalId: 1,
          parentId: null,
          metadata: {},
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `child-${index + 1}`,
          type: 'peg' as const,
          label: `${longLabel}${index + 1}`,
          originalId: index + 2,
          parentId: 'root',
          metadata: {},
        })),
      ],
      edges: Array.from({ length: 5 }, (_, index) => ({
        id: `root->child-${index + 1}`,
        source: 'root',
        target: `child-${index + 1}`,
        type: 'parent-child' as const,
      })),
    }

    const { nodes } = applyMindMapLayout(graphData)
    const children = nodes
      .filter((node) => node.id.startsWith('child-'))
      .sort((a, b) => a.position.y - b.position.y)

    expect(children).toHaveLength(5)
    for (let index = 0; index < children.length - 1; index += 1) {
      const upper = children[index]
      const lower = children[index + 1]
      expect(lower.position.y).toBeGreaterThanOrEqual(
        upper.position.y + getNodeSize(upper).height + 8,
      )
    }
  })

  it('uses measured node heights to separate sibling nodes', () => {
    const graphData: GraphData = {
      nodes: [
        {
          id: 'root',
          type: 'peg',
          label: '主题',
          originalId: 1,
          parentId: null,
          metadata: {},
        },
        {
          id: 'child-a',
          type: 'peg',
          label: '视觉上更高的节点',
          originalId: 2,
          parentId: 'root',
          metadata: {},
        },
        {
          id: 'child-b',
          type: 'peg',
          label: '短节点',
          originalId: 3,
          parentId: 'root',
          metadata: {},
        },
      ],
      edges: [
        { id: 'root->child-a', source: 'root', target: 'child-a', type: 'parent-child' },
        { id: 'root->child-b', source: 'root', target: 'child-b', type: 'parent-child' },
      ],
    }
    const measuredSizes = new Map([
      ['child-a', { width: 152, height: 128 }],
      ['child-b', { width: 152, height: 36 }],
    ])

    const { nodes } = applyMindMapLayout(graphData, measuredSizes)
    const upper = nodes.find((node) => node.id === 'child-a')
    const lower = nodes.find((node) => node.id === 'child-b')

    expect(upper).toBeTruthy()
    expect(lower).toBeTruthy()
    expect(lower!.position.y).toBeGreaterThanOrEqual(upper!.position.y + 128 + 8)
  })

  it('uses measured descendant heights when spacing sibling subtrees', () => {
    const graphData: GraphData = {
      nodes: [
        {
          id: 'root',
          type: 'peg',
          label: '主题',
          originalId: 1,
          parentId: null,
          metadata: {},
        },
        {
          id: 'branch-a',
          type: 'peg',
          label: '带高子节点的分支',
          originalId: 2,
          parentId: 'root',
          metadata: {},
        },
        {
          id: 'grand-a',
          type: 'peg',
          label: '高孙节点 A',
          originalId: 3,
          parentId: 'branch-a',
          metadata: {},
        },
        {
          id: 'grand-b',
          type: 'peg',
          label: '高孙节点 B',
          originalId: 4,
          parentId: 'branch-a',
          metadata: {},
        },
        {
          id: 'branch-b',
          type: 'peg',
          label: '下一个分支',
          originalId: 5,
          parentId: 'root',
          metadata: {},
        },
      ],
      edges: [
        { id: 'root->branch-a', source: 'root', target: 'branch-a', type: 'parent-child' },
        { id: 'branch-a->grand-a', source: 'branch-a', target: 'grand-a', type: 'parent-child' },
        { id: 'branch-a->grand-b', source: 'branch-a', target: 'grand-b', type: 'parent-child' },
        { id: 'root->branch-b', source: 'root', target: 'branch-b', type: 'parent-child' },
      ],
    }
    const measuredSizes = new Map([
      ['grand-a', { width: 136, height: 96 }],
      ['grand-b', { width: 136, height: 104 }],
      ['branch-b', { width: 152, height: 36 }],
    ])

    const { nodes } = applyMindMapLayout(graphData, measuredSizes)
    const lowerBranch = nodes.find((node) => node.id === 'branch-b')
    const lowerDescendant = nodes.find((node) => node.id === 'grand-b')

    expect(lowerBranch).toBeTruthy()
    expect(lowerDescendant).toBeTruthy()
    expect(lowerBranch!.position.y).toBeGreaterThanOrEqual(lowerDescendant!.position.y + 104 + 8)
  })
})
