import { fireEvent, render, screen } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from '@/shared/ui/mindmap-canvas/MindMapCanvas'
import type { GraphData } from '@/shared/ui/mindmap-canvas/adapter'

const reactFlowMockState = vi.hoisted(() => ({
  nextProviderId: 1,
  fitView: vi.fn(),
  setCenter: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  setViewport: vi.fn(),
  getViewport: vi.fn(),
  viewport: { x: 4, y: 18, zoom: 0.99 },
  reactFlowProps: null as Record<string, unknown> | null,
  nodes: [] as Array<{ id: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>,
}))

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    Handle: () => null,
    NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Position: {
      Left: 'left',
      Right: 'right',
    },
    ReactFlow: ({
      nodes,
      nodeTypes,
      onNodeClick,
      onNodeDoubleClick,
      onNodeContextMenu,
      ...reactFlowProps
    }: {
      nodes: Array<{ id: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>
      nodeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>
      onNodeClick?: (event: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => void
      onNodeDoubleClick?: (event: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => void
      onNodeContextMenu?: (event: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => void
      [key: string]: unknown
    }) => {
      reactFlowMockState.reactFlowProps = reactFlowProps
      reactFlowMockState.nodes = nodes
      return (
        <div data-testid="react-flow">
          {nodes.map((node) => {
            const NodeComponent = nodeTypes?.mindmapNode
            return (
              <div
                key={node.id}
                data-testid={`node-${node.id}`}
                onClick={(event) => void onNodeClick?.(event, node)}
                onDoubleClick={(event) => onNodeDoubleClick?.(event, node)}
                onContextMenu={(event) => onNodeContextMenu?.(event, node)}
              >
                <span aria-hidden="true">{node.id}</span>
                {NodeComponent ? <NodeComponent id={node.id} data={node.data ?? {}} /> : null}
              </div>
            )
          })}
        </div>
      )
    },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="react-flow-provider">{children}</div>
    ),
    useEdgesState: (initialEdges: unknown[]) => {
      const [edges, setEdges] = React.useState(initialEdges)
      return [edges, setEdges, vi.fn()]
    },
    useNodesState: (initialNodes: unknown[]) => {
      const [nodes, setNodes] = React.useState(initialNodes)
      return [nodes, setNodes, vi.fn()]
    },
    useReactFlow: () => ({
      fitView: reactFlowMockState.fitView,
      setCenter: reactFlowMockState.setCenter,
      zoomIn: reactFlowMockState.zoomIn,
      zoomOut: reactFlowMockState.zoomOut,
      getViewport: reactFlowMockState.getViewport,
      setViewport: reactFlowMockState.setViewport,
    }),
    useStore: (selector: (state: unknown) => unknown) =>
      selector({
        height: 600,
        nodeLookup: new Map(),
        transform: [0, 0, 1],
        width: 800,
      }),
    useUpdateNodeInternals: () => vi.fn(),
  }
})

const siblingGraphData: GraphData = {
  nodes: [
    {
      id: 'root',
      type: 'peg',
      label: 'Root',
      originalId: 1,
      parentId: null,
      metadata: { depth: 0, layoutRole: 'root' },
    },
    {
      id: 'child-a',
      type: 'peg',
      label: 'First child',
      originalId: 2,
      parentId: 'root',
      metadata: { depth: 1, layoutRole: 'leaf' },
    },
    {
      id: 'child-b',
      type: 'peg',
      label: 'Second child',
      originalId: 3,
      parentId: 'root',
      metadata: { depth: 1, layoutRole: 'leaf' },
    },
  ],
  edges: [
    { id: 'root-child-a', source: 'root', target: 'child-a', type: 'parent-child' },
    { id: 'root-child-b', source: 'root', target: 'child-b', type: 'parent-child' },
  ],
}

describe('MindMapCanvas multi-select context menu', () => {
  let widthSpy: ReturnType<typeof vi.spyOn>
  let heightSpy: ReturnType<typeof vi.spyOn>
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame

  beforeEach(() => {
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    window.cancelAnimationFrame = vi.fn()
    reactFlowMockState.nextProviderId = 1
    reactFlowMockState.fitView.mockClear()
    reactFlowMockState.setCenter.mockClear()
    reactFlowMockState.viewport = { x: 4, y: 18, zoom: 0.99 }
    reactFlowMockState.getViewport.mockImplementation(() => ({ ...reactFlowMockState.viewport }))
    reactFlowMockState.reactFlowProps = null
    reactFlowMockState.nodes = []
    widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    widthSpy.mockRestore()
    heightSpy.mockRestore()
  })

  it('preserves multi-select on right-click and applies highlight/delete to all targets', () => {
    const onNodeSelect = vi.fn()
    const onHighlightNodes = vi.fn()
    const onMarkColorNodes = vi.fn()
    const onDeleteNodes = vi.fn()

    render(
      <MindMapCanvas
        graphData={siblingGraphData}
        selectedNodeId="child-b"
        selectedNodeIds={['child-a', 'child-b']}
        onNodeSelect={onNodeSelect}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        onDeleteNodes={onDeleteNodes}
        onHighlightNodes={onHighlightNodes}
        onMarkColorNodes={onMarkColorNodes}
      />,
    )

    fireEvent.contextMenu(screen.getByTestId('node-child-a'), {
      clientX: 120,
      clientY: 160,
    })

    // Already in multi-select → do not collapse to a single selection.
    expect(onNodeSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '标记重点（2 张）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '标记颜色（2 张）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开调色板' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除选中（2 处）' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '编辑文字 (Enter / F2)' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '标记重点（2 张）' }))
    expect(onHighlightNodes).toHaveBeenCalledWith(['child-a', 'child-b'])
  })

  it('collapses selection when right-clicking a node outside the current multi-set', () => {
    const onNodeSelect = vi.fn()

    render(
      <MindMapCanvas
        graphData={siblingGraphData}
        selectedNodeId="child-a"
        selectedNodeIds={['child-a', 'child-b']}
        onNodeSelect={onNodeSelect}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        onHighlightNodes={vi.fn()}
      />,
    )

    fireEvent.contextMenu(screen.getByTestId('node-root'), {
      clientX: 120,
      clientY: 160,
    })

    expect(onNodeSelect).toHaveBeenCalledWith('root')
    expect(screen.getByRole('button', { name: '标记重点' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加子知识点 (Tab)' })).toBeTruthy()
  })
})
