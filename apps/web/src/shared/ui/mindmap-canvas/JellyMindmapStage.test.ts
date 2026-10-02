import { describe, expect, it } from 'vitest'
import { computeJellyLayout, jellyBezierPath, JELLY_BATCH_STAGGER_MS, JELLY_FLIP_DURATION_MS } from './JellyMindmapStage'
import type { GraphData } from './adapter'

function graph(texts: string[]): GraphData {
  const nodes = [
    { id: 'root', type: 'peg' as const, label: 'Root', originalId: 1, parentId: null, metadata: { depth: 0, text: 'Root' } },
    { id: 'parent', type: 'peg' as const, label: 'Chapter', originalId: 2, parentId: 'root', metadata: { depth: 1, text: 'Chapter' } },
    ...texts.map((text, index) => ({
      id: `leaf-${index}`,
      type: 'peg' as const,
      label: text,
      originalId: index + 3,
      parentId: 'parent',
      metadata: { depth: 2, text },
    })),
  ]
  return {
    nodes,
    edges: [
      { id: 'root-parent', source: 'root', target: 'parent', type: 'parent-child' },
      ...texts.map((_, index) => ({ id: `parent-leaf-${index}`, source: 'parent', target: `leaf-${index}`, type: 'parent-child' as const })),
    ],
  }
}

describe('JellyMindmapStage layout contract', () => {
  it('keeps fixed leaf width and equalizes sibling heights to the tallest card', () => {
    const layout = computeJellyLayout(graph(['short', 'a much longer answer that must wrap across multiple lines in the fixed card']))
    const first = layout.rects.get('leaf-0')!
    const second = layout.rects.get('leaf-1')!
    expect(first.width).toBe(270)
    expect(second.width).toBe(270)
    expect(first.height).toBe(second.height)
  })

  it('places root, parent, and leaves left-to-right with readable margins', () => {
    const layout = computeJellyLayout(graph(['one']))
    const root = layout.rects.get('root')!
    const parent = layout.rects.get('parent')!
    const leaf = layout.rects.get('leaf-0')!
    expect(root.x).toBeLessThan(parent.x)
    expect(parent.x).toBeLessThan(leaf.x)
    expect(root.x).toBeGreaterThan(0)
    expect(layout.width).toBeGreaterThan(leaf.x + leaf.width)
  })

  it('creates a cubic Bézier path from the right edge to the left edge', () => {
    const path = jellyBezierPath({ x: 10, y: 20, width: 100, height: 40 }, { x: 300, y: 80, width: 200, height: 120 })
    expect(path).toMatch(/^M 110 40 C /)
    expect(path).toMatch(/ 300 140$/)
    expect(path).toContain(' C ')
  })

  it('keeps the HTML timing contract explicit', () => {
    expect(JELLY_FLIP_DURATION_MS).toBe(550)
    expect(JELLY_BATCH_STAGGER_MS).toBe(45)
  })

  it('derives the hierarchy from edges so flat metadata still lands in columns', () => {
    // Every node claims depth 0, but the edges describe root → parent → leaf.
    const flat = graph(['one'])
    flat.nodes = flat.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, depth: 0 } }))
    const layout = computeJellyLayout(flat)
    const root = layout.rects.get('root')!
    const parent = layout.rects.get('parent')!
    const leaf = layout.rects.get('leaf-0')!
    expect(root.x).toBeLessThan(parent.x)
    expect(parent.x).toBeLessThan(leaf.x)
    expect(leaf.width).toBe(270)
  })

  it('ignores custom connections when building the tree', () => {
    const withCustom: GraphData = {
      ...graph(['one']),
      edges: [
        ...graph(['one']).edges,
        { id: 'root-leaf-custom', source: 'root', target: 'leaf-0', type: 'custom' },
      ],
    }
    const rects = computeJellyLayout(withCustom).rects
    expect(rects.get('leaf-0')!.width).toBe(270)
    // A custom link must not turn the leaf into a parent card.
    expect(rects.get('leaf-0')!.x).toBeGreaterThan(rects.get('parent')!.x)
  })

  it('grows height, never width, for long answers', () => {
    const short = computeJellyLayout(graph(['短'])).rects.get('leaf-0')!
    const long = computeJellyLayout(graph(['这是一段很长的答案文本，用来确认固定宽度下只会增加高度而不会改变卡片宽度。'])).rects.get('leaf-0')!
    expect(short.width).toBe(long.width)
    expect(long.height).toBeGreaterThanOrEqual(short.height)
  })

  it('reserves enough height for root and parent chrome', () => {
    const layout = computeJellyLayout(graph(['one']))
    expect(layout.rects.get('root')!.height).toBeGreaterThanOrEqual(115)
    expect(layout.rects.get('parent')!.height).toBeGreaterThanOrEqual(120)
  })
})
