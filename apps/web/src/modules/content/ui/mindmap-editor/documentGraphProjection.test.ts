import { describe, expect, it } from 'vitest'
import type { MindMapDoc } from '@/shared/api/contracts'
import {
  addEditorDocChildWithResult,
  addEditorDocSiblingWithResult,
  countEditorDocSubtree,
  deleteEditorDocNodeOnly,
  editorDocToGraph,
} from './documentGraphProjection'

describe('editorDocToGraph review edge styles', () => {
  const doc: MindMapDoc = {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: {
            text: 'Child',
            uid: 'child',
            lineColor: '#059669',
            lineWidth: 6,
          },
          children: [],
        },
      ],
    },
  }

  it('carries runtime line styles in practice mode', () => {
    const graph = editorDocToGraph(doc, {
      revealMap: { root: 'revealed', child: 'revealed' },
    })

    expect(graph.edges[0].renderStyle).toEqual({ stroke: '#059669', strokeWidth: 6 })
  })

  it('applies host outline emphasis without overriding range selection', () => {
    const graph = editorDocToGraph(doc, {
      outlinedNodeUids: ['child'],
    })
    const outlinedNode = graph.nodes.find((node) => node.id === 'child')
    const rootNode = graph.nodes.find((node) => node.id === 'root')

    expect(outlinedNode?.metadata.visual).toMatchObject({ borderColor: '#16a34a' })
    expect(rootNode?.metadata.visual).toMatchObject({ borderColor: null })

    const rangeSelectedGraph = editorDocToGraph(doc, {
      outlinedNodeUids: ['child'],
      segmentRangeDraft: {
        active: true,
        targetSegmentId: 'new',
        selectedNodeUids: ['child'],
        overriddenConflictNodeUids: [],
      },
    })
    expect(rangeSelectedGraph.nodes.find((node) => node.id === 'child')?.metadata.visual)
      .toMatchObject({ borderColor: '#0ea5e9' })
  })

  it('keeps decorative branch colors in view and edit modes', () => {
    const graph = editorDocToGraph(doc)

    expect(graph.edges[0].renderStyle).toBeUndefined()
  })

  it('preserves yellow emphasis markup on graph nodes for all modes', () => {
    const highlighted =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">重点</span></div>'
    const withEmphasis: MindMapDoc = {
      root: {
        data: { text: 'Root', uid: 'root' },
        children: [
          {
            data: { text: highlighted, uid: 'child-hl' },
            children: [],
          },
        ],
      },
    }

    const editGraph = editorDocToGraph(withEmphasis)
    const reviewGraph = editorDocToGraph(withEmphasis, {
      revealMap: { root: 'revealed', 'child-hl': 'revealed' },
    })

    for (const graph of [editGraph, reviewGraph]) {
      const node = graph.nodes.find((item) => item.id === 'child-hl')
      expect(String(node?.metadata?.text)).toContain('data-emphasis="highlight"')
      expect(String(node?.metadata?.text)).toContain('重点')
      expect(node?.metadata?.richText).toBe(true)
      // Plain label stays unstyled for measurement / search.
      expect(node?.label).toBe('重点')
    }
  })
})

describe('editor document structural edits', () => {
  const doc: MindMapDoc = {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: { text: 'A', uid: 'a' },
          children: [
            { data: { text: 'A1', uid: 'a1' }, children: [] },
            { data: { text: 'A2', uid: 'a2' }, children: [] },
          ],
        },
        { data: { text: 'B', uid: 'b' }, children: [] },
      ],
    },
  }

  it('returns the created uid for child and sibling insertion', () => {
    const childResult = addEditorDocChildWithResult(doc, 'a')
    const siblingResult = addEditorDocSiblingWithResult(childResult.editorDoc, 'a')

    expect(childResult.nodeUid).toBeTruthy()
    expect(siblingResult.nodeUid).toBeTruthy()
    expect(childResult.nodeUid).not.toBe(siblingResult.nodeUid)
    expect(countEditorDocSubtree(siblingResult.editorDoc, 'root')).toBe(7)
  })

  it('deletes only the selected card and promotes its children in place', () => {
    const next = deleteEditorDocNodeOnly(doc, 'a')
    const graph = editorDocToGraph(next)

    expect(graph.nodes.map((node) => node.id)).toEqual(['root', 'a1', 'a2', 'b'])
    expect(graph.nodes.find((node) => node.id === 'a1')?.parentId).toBe('root')
    expect(graph.nodes.find((node) => node.id === 'a2')?.parentId).toBe('root')
    expect(countEditorDocSubtree(next, 'a')).toBe(0)
  })

  it('protects the root from node-only deletion', () => {
    const next = deleteEditorDocNodeOnly(doc, 'root')

    expect(editorDocToGraph(next).nodes).toHaveLength(5)
  })
})

describe('editorDocToGraph scopeBranchUid', () => {
  const doc: MindMapDoc = {
    root: {
      data: { text: 'Palace', uid: 'root' },
      children: [
        {
          data: { text: 'Parent', uid: 'parent' },
          children: [
            {
              data: { text: 'Branch', uid: 'branch' },
              children: [
                { data: { text: 'Leaf A', uid: 'leaf-a' }, children: [] },
                { data: { text: 'Leaf B', uid: 'leaf-b' }, children: [] },
              ],
            },
            { data: { text: 'Sibling', uid: 'sibling' }, children: [] },
          ],
        },
        { data: { text: 'Other', uid: 'other' }, children: [] },
      ],
    },
  }

  it('projects the spine plus the unit subtree and drops sibling branches', () => {
    const graph = editorDocToGraph(doc, { scopeBranchUid: 'branch' })
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'root',
      'parent',
      'branch',
      'leaf-a',
      'leaf-b',
    ])
    expect(graph.nodes.find((node) => node.id === 'parent')?.parentId).toBe('root')
    expect(graph.nodes.find((node) => node.id === 'branch')?.parentId).toBe('parent')
  })

  it('falls back to the full document when the branch uid is missing', () => {
    const graph = editorDocToGraph(doc, { scopeBranchUid: 'missing' })
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'root',
      'parent',
      'branch',
      'leaf-a',
      'leaf-b',
      'sibling',
      'other',
    ])
  })
})

describe('editorDocToGraph node payload shape', () => {
  const doc: MindMapDoc = {
    root: {
      data: { text: 'Root', uid: 'root' },
      children: [
        {
          data: { text: 'Branch', uid: 'branch' },
          children: [{ data: { text: 'Leaf', uid: 'leaf' }, children: [] }],
        },
      ],
    },
  }

  /**
   * Projected metadata must stay flat.
   *
   * `rawNode` used to embed the original document node with its whole subtree.
   * Two per-flip costs followed from that: the layout comparator stringified each
   * node's data (so the payload was O(N x subtree) JSON text), and because a
   * pristine doc node is a fresh object after every deep clone, it forced a
   * mismatch in the reference-based `shallowEqualNodeData` — which defeated every
   * downstream identity reuse and re-rendered all cards on each reveal.
   */
  it('does not embed the source document node in node metadata', () => {
    const graph = editorDocToGraph(doc)

    for (const node of graph.nodes) {
      expect(node.metadata).not.toHaveProperty('rawNode')
    }
  })

  it('keeps the projected metadata serializable without a nested subtree', () => {
    const graph = editorDocToGraph(doc)
    const branch = graph.nodes.find((node) => node.id === 'branch')
    const serialized = JSON.stringify(branch?.metadata ?? {})

    // The subtree's own text must not appear inside a different node's payload.
    expect(serialized).not.toContain('Leaf')
  })

  it('produces identical metadata for the same node across separate projections', () => {
    // A flip re-projects the document from a freshly cloned tree. Equivalent
    // input must serialize equal, so the layout comparator can recognise a no-op
    // instead of writing new node objects for every node on every flip.
    const first = editorDocToGraph(doc)
    const second = editorDocToGraph(doc)
    const metadataOf = (graph: typeof first, id: string) =>
      JSON.stringify(graph.nodes.find((node) => node.id === id)?.metadata ?? {})

    for (const id of ['root', 'branch', 'leaf']) {
      expect(metadataOf(first, id)).toBe(metadataOf(second, id))
    }
  })

  it('still lets a reveal change a node, so revealed cards do repaint', () => {
    // Guard against "fixing" the flip cost by freezing data: the reveal state is
    // real visual information and must keep flowing into the projection.
    const hidden = editorDocToGraph(doc, { revealMap: {} })
    const revealed = editorDocToGraph(doc, {
      revealMap: { root: 'revealed', branch: 'revealed', leaf: 'revealed' },
    })
    const visualOf = (graph: typeof hidden, id: string) =>
      JSON.stringify(graph.nodes.find((node) => node.id === id)?.metadata?.visual ?? {})

    expect(visualOf(hidden, 'leaf')).not.toBe(visualOf(revealed, 'leaf'))
  })
})
