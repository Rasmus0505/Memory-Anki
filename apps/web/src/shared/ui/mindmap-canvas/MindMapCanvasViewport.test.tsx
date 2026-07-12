import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { MindMapCanvasViewport } from './MindMapCanvasViewport'

vi.mock('@xyflow/react', () => ({
  Background: () => <div data-testid="background" />,
  BackgroundVariant: {
    Dots: 'dots',
  },
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
  ReactFlow: ({ children, nodesDraggable, nodesFocusable, edgesFocusable, deleteKeyCode, panOnScroll, zoomOnDoubleClick }: {
    children: React.ReactNode
    nodesDraggable: boolean
    nodesFocusable: boolean
    edgesFocusable: boolean
    deleteKeyCode: unknown
    panOnScroll: boolean
    zoomOnDoubleClick: boolean
  }) => (
    <div
      data-testid="react-flow"
      data-nodes-draggable={String(nodesDraggable)}
      data-nodes-focusable={String(nodesFocusable)}
      data-edges-focusable={String(edgesFocusable)}
      data-delete-key-code={String(deleteKeyCode)}
      data-pan-on-scroll={String(panOnScroll)}
      data-zoom-on-double-click={String(zoomOnDoubleClick)}
    >
      {children}
    </div>
  ),
}))

function buildNodes(count: number): Node[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    type: 'mindmapNode',
    position: { x: index * 10, y: index * 4 },
    data: {
      label: `node-${index}`,
      metadata: {},
    },
  }))
}

function renderViewport(overrides?: Partial<React.ComponentProps<typeof MindMapCanvasViewport>>) {
  const props: React.ComponentProps<typeof MindMapCanvasViewport> = {
    width: 800,
    height: 600,
    nodes: buildNodes(4),
    edges: [] as Edge[],
    isDraggingNode: false,
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onNodeClick: vi.fn(),
    onNodeDoubleClick: vi.fn(),
    onNodeContextMenu: vi.fn(),
    onNodeDragStart: vi.fn(),
    onNodeDrag: vi.fn(),
    onNodeDragStop: vi.fn(),
    onNodeMouseEnter: vi.fn(),
    onNodeMouseLeave: vi.fn(),
    onEdgeClick: vi.fn(),
    onEdgeDoubleClick: vi.fn(),
    onPaneClick: vi.fn(),
    ...overrides,
  }
  return render(<MindMapCanvasViewport {...props} />)
}

describe('MindMapCanvasViewport', () => {
  it('renders minimap and background for small interactive maps', () => {
    renderViewport()

    expect(screen.getByTestId('minimap')).toBeTruthy()
    expect(screen.getByTestId('background')).toBeTruthy()
    expect(screen.getByTestId('react-flow').dataset.nodesDraggable).toBe('true')
    expect(screen.getByTestId('react-flow').dataset.nodesFocusable).toBe('false')
    expect(screen.getByTestId('react-flow').dataset.edgesFocusable).toBe('false')
    expect(screen.getByTestId('react-flow').dataset.deleteKeyCode).toBe('null')
  })

  it('hides decorative layers while dragging', () => {
    renderViewport({ isDraggingNode: true })

    expect(screen.queryByTestId('minimap')).toBeNull()
    expect(screen.queryByTestId('background')).toBeNull()
  })

  it('hides decorative layers for large maps and keeps readonly nodes fixed', () => {
    renderViewport({ nodes: buildNodes(240), readonly: true })

    expect(screen.queryByTestId('minimap')).toBeNull()
    expect(screen.queryByTestId('background')).toBeNull()
    expect(screen.getByTestId('react-flow').dataset.nodesDraggable).toBe('false')
  })

  it('uses guided mobile interaction props', () => {
    renderViewport({ mobileGuided: true })

    expect(screen.getByTestId('react-flow').dataset.panOnScroll).toBe('false')
    expect(screen.getByTestId('react-flow').dataset.zoomOnDoubleClick).toBe('false')
    expect(screen.queryByTestId('minimap')).toBeNull()
  })
})
