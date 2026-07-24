import { describe, expect, it } from 'vitest'
import {
  applyMindMapLayout,
  buildPreviewGraph,
  getNodeSize,
  isWithinStructureDropLeaveZone,
  NODE_SAFE_GAP,
  resolveStructureDropMode,
} from './layout'
import type { GraphData } from './adapter'

describe('mind map layout sizing', () => {
  it('grows node height for long labels', () => {
    const shortSize = getNodeSize('branch', '短节点')
    const longSize = getNodeSize(
      'branch',
      '路德提出应由国家普及义务教育，实施强迫义务教育。加尔文要求国家开办公立学校，实行免费教育；使所有儿童都有机会受到教育。',
    )

    expect(longSize.width).toBeGreaterThan(shortSize.width)
    expect(shortSize.width).toBe(73)
    expect(longSize.width).toBeLessThanOrEqual(294)
    expect(longSize.height).toBeGreaterThan(shortSize.height)
  })

  it('uses intrinsic width until the shared twenty-character visual limit', () => {
    const oneCharacter = getNodeSize('branch', '一')
    const fourCharacters = getNodeSize('branch', '一二三四')
    const fiveCharacters = getNodeSize('branch', '一二三四五')
    const twentyCharacters = getNodeSize('branch', '一二三四五六七八九十一二三四五六七八九十')
    const twentyOneCharacters = getNodeSize('branch', '一二三四五六七八九十一二三四五六七八九十一')
    const mixedText = getNodeSize('branch', 'Memory Anki 记忆卡片')

    expect(oneCharacter.width).toBe(47)
    // Short CJK labels keep a single-line shell (content box >= 4 full-width chars).
    expect(fourCharacters.width).toBe(86)
    expect(fourCharacters.height).toBe(oneCharacter.height)
    expect(fiveCharacters.width).toBe(99)
    expect(twentyCharacters.width).toBe(294)
    expect(twentyOneCharacters.width).toBe(294)
    expect(twentyOneCharacters.height).toBeGreaterThan(twentyCharacters.height)
    expect(mixedText.width).toBeLessThan(twentyCharacters.width)
  })

  it('widens cards so long English words are not forced mid-word', () => {
    const short = getNodeSize('branch', 'cat')
    const longWord = getNodeSize('branch', 'responsibility')
    const phrase = getNodeSize('leaf', 'responsibility and accountability')
    // ~45 Latin letters → weighted length past the soft 20-fullwidth budget.
    const veryLongWord = getNodeSize(
      'branch',
      'pneumonoultramicroscopicsilicovolcanoconiosis',
    )
    const softMax = getNodeSize(
      'branch',
      '一二三四五六七八九十一二三四五六七八九十',
    ).width

    expect(longWord.width).toBeGreaterThan(short.width)
    expect(phrase.width).toBeGreaterThanOrEqual(longWord.width)
    expect(veryLongWord.width).toBeGreaterThan(softMax)
  })

  it('grows node height for explicit line breaks', () => {
    const singleLine = getNodeSize('leaf', '第一行')
    const multiLine = getNodeSize('leaf', '第一行\n第二行\n第三行')

    expect(multiLine.height).toBeGreaterThan(singleLine.height)
  })

  it('restricts node dragging to the dedicated drag handle', () => {
    const graphData: GraphData = {
      nodes: [
        {
          id: 'root',
          type: 'peg',
          label: '可编辑节点',
          originalId: 1,
          parentId: null,
          metadata: {},
        },
      ],
      edges: [],
    }

    const { nodes } = applyMindMapLayout(graphData)

    expect(nodes[0]).toMatchObject({
      draggable: false,
    })
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
    expect(bottomNode.position.y).toBeGreaterThanOrEqual(topNode.position.y + topSize.height + NODE_SAFE_GAP)
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
        upper.position.y + getNodeSize(upper).height + NODE_SAFE_GAP,
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
    expect(lower!.position.y).toBeGreaterThanOrEqual(upper!.position.y + 128 + NODE_SAFE_GAP)
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
    expect(lowerBranch!.position.y).toBeGreaterThanOrEqual(lowerDescendant!.position.y + 104 + NODE_SAFE_GAP)
  })

  it('keeps every measured card rectangle separated in a dense multi-level tree', () => {
    const graphData: GraphData = {
      nodes: [
        { id: 'root', type: 'peg', label: '教育思想', originalId: 1, parentId: null, metadata: {} },
        { id: 'branch-a', type: 'peg', label: '管理', originalId: 2, parentId: 'root', metadata: {} },
        { id: 'branch-b', type: 'peg', label: '不同点与共同点', originalId: 3, parentId: 'root', metadata: {} },
        { id: 'leaf-a1', type: 'peg', label: '完整的组织管理制度，以学校整体设计为标准和尺度。', originalId: 4, parentId: 'branch-a', metadata: {} },
        { id: 'leaf-a2', type: 'peg', label: '新教教育反对人文主义教育中的异教因素', originalId: 5, parentId: 'branch-a', metadata: {} },
        { id: 'leaf-b1', type: 'peg', label: '在教育的基础上', originalId: 6, parentId: 'branch-b', metadata: {} },
        { id: 'leaf-b2', type: 'peg', label: '在对宗教改革的态度上', originalId: 7, parentId: 'branch-b', metadata: {} },
      ],
      edges: [
        { id: 'root->branch-a', source: 'root', target: 'branch-a', type: 'parent-child' },
        { id: 'root->branch-b', source: 'root', target: 'branch-b', type: 'parent-child' },
        { id: 'branch-a->leaf-a1', source: 'branch-a', target: 'leaf-a1', type: 'parent-child' },
        { id: 'branch-a->leaf-a2', source: 'branch-a', target: 'leaf-a2', type: 'parent-child' },
        { id: 'branch-b->leaf-b1', source: 'branch-b', target: 'leaf-b1', type: 'parent-child' },
        { id: 'branch-b->leaf-b2', source: 'branch-b', target: 'leaf-b2', type: 'parent-child' },
      ],
    }
    const measuredSizes = new Map([
      ['root', { width: 200, height: 42 }],
      ['branch-a', { width: 180, height: 38 }],
      ['branch-b', { width: 210, height: 58 }],
      ['leaf-a1', { width: 280, height: 92 }],
      ['leaf-a2', { width: 260, height: 78 }],
      ['leaf-b1', { width: 180, height: 42 }],
      ['leaf-b2', { width: 220, height: 64 }],
    ])

    const { nodes } = applyMindMapLayout(graphData, measuredSizes)

    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
      const first = nodes[firstIndex]
      const firstSize = measuredSizes.get(first.id) ?? getNodeSize(first)
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
        const second = nodes[secondIndex]
        const secondSize = measuredSizes.get(second.id) ?? getNodeSize(second)
        const horizontallySeparated =
          first.position.x + firstSize.width + NODE_SAFE_GAP <= second.position.x ||
          second.position.x + secondSize.width + NODE_SAFE_GAP <= first.position.x
        const verticallySeparated =
          first.position.y + firstSize.height + NODE_SAFE_GAP <= second.position.y ||
          second.position.y + secondSize.height + NODE_SAFE_GAP <= first.position.y

        expect(horizontallySeparated || verticallySeparated).toBe(true)
      }
    }
  })

  it('builds preview graph for inside drops without mutating source graph data', () => {
    const graphData: GraphData = {
      nodes: [
        { id: 'root', type: 'peg', label: 'root', originalId: 1, parentId: null, metadata: {} },
        { id: 'a', type: 'peg', label: 'a', originalId: 2, parentId: 'root', metadata: {} },
        { id: 'b', type: 'peg', label: 'b', originalId: 3, parentId: 'root', metadata: {} },
      ],
      edges: [
        { id: 'root->a', source: 'root', target: 'a', type: 'parent-child' },
        { id: 'root->b', source: 'root', target: 'b', type: 'parent-child' },
      ],
    }

    const preview = buildPreviewGraph(graphData, { sourceId: 'a', targetId: 'b', mode: 'inside' })
    const previewA = preview.nodes.find((node) => node.id === 'a')

    expect(previewA?.data.parentId).toBe('b')
    expect(graphData.nodes.find((node) => node.id === 'a')?.parentId).toBe('root')
  })

  it('guards preview graph when dropping into a descendant', () => {
    const graphData: GraphData = {
      nodes: [
        { id: 'root', type: 'peg', label: 'root', originalId: 1, parentId: null, metadata: {} },
        { id: 'a', type: 'peg', label: 'a', originalId: 2, parentId: 'root', metadata: {} },
        { id: 'a-child', type: 'peg', label: 'a-child', originalId: 3, parentId: 'a', metadata: {} },
      ],
      edges: [
        { id: 'root->a', source: 'root', target: 'a', type: 'parent-child' },
        { id: 'a->a-child', source: 'a', target: 'a-child', type: 'parent-child' },
      ],
    }

    const original = applyMindMapLayout(graphData)
    const preview = buildPreviewGraph(graphData, {
      sourceId: 'a',
      targetId: 'a-child',
      mode: 'inside',
    })

    expect(preview.nodes.map((node) => [node.id, node.position])).toEqual(
      original.nodes.map((node) => [node.id, node.position]),
    )
  })

  it('prefers runtime review edge styles over decorative branch colors', () => {
    const graphData: GraphData = {
      nodes: [
        { id: 'root', type: 'peg', label: 'root', originalId: 1, parentId: null, metadata: {} },
        { id: 'child', type: 'peg', label: 'child', originalId: 2, parentId: 'root', metadata: {} },
      ],
      edges: [
        {
          id: 'root->child',
          source: 'root',
          target: 'child',
          type: 'parent-child',
          renderStyle: { stroke: '#059669', strokeWidth: 6 },
        },
      ],
    }

    const layout = applyMindMapLayout(graphData)

    expect(layout.edges[0]).toMatchObject({
      type: 'default',
      pathOptions: { curvature: 0.32 },
      style: {
        stroke: '#059669',
        strokeWidth: 6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    })
  })

  it('lays out large graphs within a small synchronous budget', () => {
    const graphData = buildLargeGraphData(800)
    const startedAt = performance.now()

    const layout = applyMindMapLayout(graphData)
    const elapsed = performance.now() - startedAt

    expect(layout.nodes).toHaveLength(800)
    expect(layout.edges).toHaveLength(799)
    expect(elapsed).toBeLessThan(250)
  })
})

describe('resolveStructureDropMode', () => {
  const rect = { x: 100, y: 200, width: 120, height: 40 }

  it('treats any pointer on the card body as becoming a child', () => {
    expect(resolveStructureDropMode(110, 205, rect)).toBe('inside')
    expect(resolveStructureDropMode(110, 202, rect)).toBe('inside')
    expect(resolveStructureDropMode(110, 238, rect)).toBe('inside')
  })

  it('offers sibling modes only in the vertical gap above or below a non-root card', () => {
    expect(resolveStructureDropMode(160, 180, rect)).toBe('before')
    expect(resolveStructureDropMode(160, 260, rect)).toBe('after')
  })

  it('does not treat pure horizontal near-miss as sibling reorder', () => {
    expect(resolveStructureDropMode(40, 220, rect)).toBeNull()
    expect(resolveStructureDropMode(250, 220, rect)).toBeNull()
  })

  it('only accepts on-card child drops for the root', () => {
    expect(resolveStructureDropMode(110, 220, rect, { isRoot: true })).toBe('inside')
    expect(resolveStructureDropMode(160, 180, rect, { isRoot: true })).toBeNull()
    expect(resolveStructureDropMode(160, 260, rect, { isRoot: true })).toBeNull()
  })

  it('keeps an active inside preview sticky inside the leave zone', () => {
    expect(
      isWithinStructureDropLeaveZone(160, 185, rect, 'inside', { leaveExtraPx: 24 }),
    ).toBe(true)
    expect(
      isWithinStructureDropLeaveZone(160, 80, rect, 'inside', { leaveExtraPx: 24 }),
    ).toBe(false)
  })
})

function buildLargeGraphData(count: number): GraphData {
  const nodes: GraphData['nodes'] = []
  const edges: GraphData['edges'] = []
  for (let index = 0; index < count; index += 1) {
    const id = `node-${index}`
    const parentId = index === 0 ? null : `node-${Math.floor((index - 1) / 3)}`
    nodes.push({
      id,
      type: 'peg',
      label: `节点 ${index}`,
      originalId: index,
      parentId,
      metadata: {},
    })
    if (parentId) {
      edges.push({
        id: `${parentId}->${id}`,
        source: parentId,
        target: id,
        type: 'parent-child',
      })
    }
  }
  return { nodes, edges }
}
