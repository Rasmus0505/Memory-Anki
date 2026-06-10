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
    expect(bottomNode.position.y).toBeGreaterThanOrEqual(topNode.position.y + topSize.height)
  })
})
