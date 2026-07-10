import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { buildDisplayEdges, buildDisplayNodes } from './mindMapCanvasDisplay'

function makeNode(id: string, x = 0, y = 0): Node {
  return {
    id,
    type: 'mindmapNode',
    position: { x, y },
    data: {
      id,
      type: 'peg',
      label: id,
      originalId: 1,
      parentId: null,
      metadata: {},
    },
  }
}

function makeEdge(id: string): Edge {
  const [source, target] = id.split('->')
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    style: { stroke: '#89a89e', strokeWidth: 1.5, opacity: 0.94 },
  }
}

describe('mindMapCanvasDisplay', () => {
  it('reuses unchanged node objects while updating selected nodes', () => {
    const onAddChild = vi.fn()
    const onDelete = vi.fn()
    const onFinishEdit = vi.fn()
    const onMeasure = vi.fn()
    const nodes = [makeNode('a'), makeNode('b')]
    const first = buildDisplayNodes({
      nodes,
      previewNodes: [],
      previewState: null,
      sourceId: null,
      isDraggingNode: false,
      selectedNodeId: 'a',
      editingNodeId: null,
      editingDraft: null,
      onStartEdit: vi.fn(),
      onCancelEdit: vi.fn(),
      onAddChild,
      onAddSibling: vi.fn(),
      onDelete,
      onFinishEdit,
      onMeasure,
      readonly: false,
    })

    const second = buildDisplayNodes({
      nodes,
      previewNodes: [],
      previewState: null,
      previousDisplayNodes: first,
      sourceId: null,
      isDraggingNode: false,
      selectedNodeId: 'b',
      editingNodeId: null,
      editingDraft: null,
      onStartEdit: vi.fn(),
      onCancelEdit: vi.fn(),
      onAddChild,
      onAddSibling: vi.fn(),
      onDelete,
      onFinishEdit,
      onMeasure,
      readonly: false,
    })

    expect(second[0]).not.toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[0].data.selected).toBe(false)
    expect(second[1].data.selected).toBe(true)

    const third = buildDisplayNodes({
      nodes,
      previewNodes: [],
      previewState: null,
      previousDisplayNodes: second,
      sourceId: null,
      isDraggingNode: false,
      selectedNodeId: 'b',
      editingNodeId: null,
      editingDraft: null,
      onStartEdit: second[0].data.onStartEdit as (nodeId: string) => void,
      onCancelEdit: second[0].data.onCancelEdit as (nodeId: string) => void,
      onAddChild,
      onAddSibling: second[0].data.onAddSibling as (nodeId: string) => void,
      onDelete,
      onFinishEdit,
      onMeasure,
      readonly: false,
    })

    expect(third[0]).toBe(second[0])
    expect(third[1]).toBe(second[1])
  })

  it('marks only drag source and drop target during lightweight preview', () => {
    const nodes = [makeNode('source'), makeNode('target'), makeNode('other')]
    const displayNodes = buildDisplayNodes({
      nodes,
      previewNodes: [],
      previewState: { sourceId: 'source', targetId: 'target', mode: 'inside' },
      sourceId: 'source',
      isDraggingNode: true,
      selectedNodeId: 'source',
      editingNodeId: null,
      editingDraft: null,
      onStartEdit: vi.fn(),
      onCancelEdit: vi.fn(),
      onAddChild: vi.fn(),
      onAddSibling: vi.fn(),
      onDelete: vi.fn(),
      onFinishEdit: vi.fn(),
      onMeasure: vi.fn(),
      readonly: true,
    })

    expect(displayNodes.find((node) => node.id === 'source')?.data.previewGhost).toBe(true)
    expect(displayNodes.find((node) => node.id === 'target')?.data.dropHighlight).toBe(true)
    expect(displayNodes.find((node) => node.id === 'target')?.data.previewAdopt).toBe(true)
    expect(displayNodes.find((node) => node.id === 'other')?.data.dropHighlight).toBe(false)
    expect(displayNodes.every((node) => node.data.readonly === true)).toBe(true)
  })

  it('reuses unchanged edge objects and only replaces selected edge styling', () => {
    const edges = [makeEdge('a->b'), makeEdge('a->c')]
    const first = buildDisplayEdges(edges, null)
    const second = buildDisplayEdges(edges, 'a->c', first)

    expect(second[0]).toBe(first[0])
    expect(second[1]).not.toBe(first[1])
    expect(second[1].className).toContain('memory-anki-reactflow-edge-selected')
    expect(second[1].style?.stroke).toBe('#4f6d67')
    expect(second[1].style?.strokeWidth).toBe(3)
  })

  it('keeps thick semantic edges thick when selected', () => {
    const edge = makeEdge('a->b')
    edge.style = { ...edge.style, strokeWidth: 6 }

    const [selected] = buildDisplayEdges([edge], edge.id)

    expect(selected.style?.strokeWidth).toBe(7)
  })
})
