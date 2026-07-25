import { describe, expect, it } from 'vitest'
import type { GraphData, MindMapNode } from './adapter'
import { applyMindMapLayout } from './layout'
import {
  AUTO_COLLAPSE_MIN_NODES,
  collectHiddenNodeIds,
  computeDefaultCollapsedNodeIds,
  expandAncestorsForNode,
  reconcileCollapsedNodeIds,
  toggleCollapsedNodeId,
} from './mindMapCollapse'

function node(
  id: string,
  parentId: string | null,
  label = id,
): MindMapNode {
  return {
    id,
    type: 'chapter',
    label,
    originalId: Number(id.replace(/\D/g, '') || 0),
    parentId,
    metadata: {},
  }
}

/** root -> L1a, L1b; L1a -> L2a -> L3a; L1b -> L2b */
function sampleTree(): MindMapNode[] {
  return [
    node('root', null),
    node('l1a', 'root'),
    node('l1b', 'root'),
    node('l2a', 'l1a'),
    node('l3a', 'l2a'),
    node('l2b', 'l1b'),
  ]
}

function largeDeepTree(count: number): MindMapNode[] {
  const nodes: MindMapNode[] = [node('root', null)]
  let parent = 'root'
  for (let i = 1; i < count; i += 1) {
    const id = `n${i}`
    nodes.push(node(id, parent))
    // Branch every few nodes so many parents have children.
    if (i % 3 !== 0) parent = id
    else parent = 'root'
  }
  return nodes
}

describe('mindMapCollapse', () => {
  it('hides descendants under collapsed parents only', () => {
    const nodes = sampleTree()
    const hidden = collectHiddenNodeIds(nodes, new Set(['l1a']))
    expect(hidden.has('l1a')).toBe(false)
    expect(hidden.has('l2a')).toBe(true)
    expect(hidden.has('l3a')).toBe(true)
    expect(hidden.has('l1b')).toBe(false)
    expect(hidden.has('l2b')).toBe(false)
  })

  it('does not auto-collapse small maps', () => {
    expect(computeDefaultCollapsedNodeIds(sampleTree()).size).toBe(0)
  })

  it('auto-collapses deep parents on large maps', () => {
    const nodes = largeDeepTree(AUTO_COLLAPSE_MIN_NODES + 10)
    const collapsed = computeDefaultCollapsedNodeIds(nodes)
    expect(collapsed.size).toBeGreaterThan(0)
    // Root (depth 0) should stay expanded under default maxExpandedDepth=1.
    expect(collapsed.has('root')).toBe(false)
  })

  it('practice mode forces fully expanded on reconcile', () => {
    const nodes = largeDeepTree(AUTO_COLLAPSE_MIN_NODES + 5)
    const previous = computeDefaultCollapsedNodeIds(nodes)
    expect(previous.size).toBeGreaterThan(0)
    const next = reconcileCollapsedNodeIds(previous, nodes, { practiceModeActive: true })
    expect(next.size).toBe(0)
  })

  it('toggle and expand-ancestors work together', () => {
    const nodes = sampleTree()
    let collapsed = new Set(['l1a', 'l2a'])
    collapsed = toggleCollapsedNodeId(collapsed, 'l1a')
    expect(collapsed.has('l1a')).toBe(false)
    collapsed = expandAncestorsForNode(nodes, new Set(['l1a', 'l2a']), 'l3a')
    expect(collapsed.has('l1a')).toBe(false)
    expect(collapsed.has('l2a')).toBe(false)
  })
})

describe('applyMindMapLayout collapse', () => {
  it('omits descendants of collapsed nodes from the positioned graph', () => {
    const graph: GraphData = { nodes: sampleTree(), edges: [] }
    // Synthesize parent-child edges like the adapter would.
    graph.edges = graph.nodes
      .filter((item) => item.parentId)
      .map((item) => ({
        id: `${item.parentId}->${item.id}`,
        source: item.parentId!,
        target: item.id,
        type: 'parent-child' as const,
      }))

    const full = applyMindMapLayout(graph)
    expect(full.nodes.map((n) => n.id).sort()).toEqual(
      ['l1a', 'l1b', 'l2a', 'l2b', 'l3a', 'root'].sort(),
    )

    const folded = applyMindMapLayout(graph, undefined, new Set(['l1a']))
    const ids = folded.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['l1a', 'l1b', 'l2b', 'root'].sort())
    expect(folded.edges.every((edge) => ids.includes(edge.source) && ids.includes(edge.target))).toBe(true)

    const l1a = folded.nodes.find((n) => n.id === 'l1a')
    const meta = (l1a?.data as { metadata?: Record<string, unknown> })?.metadata ?? {}
    expect(meta.collapsed).toBe(true)
    expect(meta.childCount).toBe(1)
    expect(meta.collapsedDescendantCount).toBe(2)
  })
})
