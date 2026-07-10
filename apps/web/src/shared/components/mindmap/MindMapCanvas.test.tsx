import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from './MindMapCanvas'
import type { GraphData } from './adapter'

const reactFlowMockState = vi.hoisted(() => ({
  nextProviderId: 1,
  fitView: vi.fn(),
  setCenter: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}))

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    Handle: () => null,
    MiniMap: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
    ReactFlow: ({
      nodes,
      onNodeClick,
      onNodeContextMenu,
    }: {
      nodes: Array<{ id: string; data?: Record<string, unknown> }>
      onNodeClick?: (event: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => void
      onNodeContextMenu?: (event: React.MouseEvent, node: { id: string; data?: Record<string, unknown> }) => void
    }) => (
      <div data-testid="react-flow">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid={`node-${node.id}`}
            data-long-press={node.data?.onTouchLongPress ? 'yes' : 'no'}
            onClick={(event) => {
              void onNodeClick?.(event, node)
              const touchLongPress = node.data?.onTouchLongPress as
                | ((nodeId: string, point: { x: number; y: number }) => void)
                | undefined
              touchLongPress?.(node.id, { x: 0, y: 0 })
            }}
            onContextMenu={(event) => onNodeContextMenu?.(event, node)}
          >
            {node.id}
          </button>
        ))}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => {
      const providerIdRef = React.useRef<number | null>(null)
      if (providerIdRef.current == null) {
        providerIdRef.current = reactFlowMockState.nextProviderId
        reactFlowMockState.nextProviderId += 1
      }
      return (
        <div data-testid="react-flow-provider" data-provider-id={providerIdRef.current}>
          {children}
        </div>
      )
    },
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
    }),
    useUpdateNodeInternals: () => vi.fn(),
  }
})

const graphData: GraphData = {
  nodes: [
    {
      id: 'root',
      type: 'peg',
      label: 'Root',
      originalId: 1,
      parentId: null,
      metadata: { depth: 0, layoutRole: 'root' },
    },
  ],
  edges: [],
}

const expandedGraphData: GraphData = {
  nodes: [
    ...graphData.nodes,
    {
      id: 'child',
      type: 'peg',
      label: 'Child',
      originalId: 2,
      parentId: 'root',
      metadata: { depth: 1, layoutRole: 'branch' },
    },
  ],
  edges: [
    {
      id: 'root-child',
      source: 'root',
      target: 'child',
      type: 'parent-child',
    },
  ],
}

describe('MindMapCanvas recovery', () => {
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
    reactFlowMockState.zoomIn.mockClear()
    reactFlowMockState.zoomOut.mockClear()
    widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  })

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    widthSpy.mockRestore()
    heightSpy.mockRestore()
  })

  it('rebuilds the ReactFlow provider when refreshing the mind map host', () => {
    render(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const firstProviderId = screen
      .getByTestId('react-flow-provider')
      .getAttribute('data-provider-id')

    fireEvent.click(screen.getByTitle('刷新脑图'))

    expect(screen.getByTestId('react-flow-provider').getAttribute('data-provider-id')).not.toBe(
      firstProviderId,
    )
    expect(screen.getByTestId('react-flow').textContent).toContain('root')
  })

  it('enables touch long press actions only in practice mode on coarse pointers', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('(pointer: coarse)'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia

    const onNodeContextAction = vi.fn()

    try {
      render(
        <MindMapCanvas
          graphData={graphData}
          selectedNodeId={null}
          onNodeSelect={vi.fn()}
          onAddChild={vi.fn()}
          onAddSibling={vi.fn()}
          onDelete={vi.fn()}
          onNodeContextAction={onNodeContextAction}
          practiceModeActive
        />,
      )

      const rootNode = screen.getByTestId('node-root')
      expect(rootNode.getAttribute('data-long-press')).toBe('yes')
      fireEvent.click(rootNode)

      expect(onNodeContextAction).toHaveBeenCalledWith('root')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('centers guided mobile node clicks only when the click viewport policy allows it', async () => {
    const { rerender } = render(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
      />,
    )

    await waitFor(() => expect(reactFlowMockState.fitView).toHaveBeenCalled())
    reactFlowMockState.fitView.mockClear()
    fireEvent.click(screen.getByTestId('node-root'))

    expect(reactFlowMockState.setCenter).toHaveBeenCalled()

    reactFlowMockState.setCenter.mockClear()
    rerender(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
        nodeClickViewportPolicy="preserve"
      />,
    )

    fireEvent.click(screen.getByTestId('node-root'))

    expect(reactFlowMockState.setCenter).not.toHaveBeenCalled()
    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()
  })

  it('keeps guided mobile content changes from fitting again when preserving the viewport', async () => {
    const { rerender } = render(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
        contentChangeViewportPolicy="preserve"
      />,
    )

    await waitFor(() => expect(reactFlowMockState.fitView).toHaveBeenCalledTimes(1))
    reactFlowMockState.fitView.mockClear()

    rerender(
      <MindMapCanvas
        graphData={expandedGraphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
        contentChangeViewportPolicy="preserve"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('node-child')).toBeTruthy())
    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()
  })

  it('keeps the default guided mobile auto-fit behavior for content changes', async () => {
    const { rerender } = render(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
      />,
    )

    await waitFor(() => expect(reactFlowMockState.fitView).toHaveBeenCalledTimes(1))
    reactFlowMockState.fitView.mockClear()

    rerender(
      <MindMapCanvas
        graphData={expandedGraphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
      />,
    )

    await waitFor(() => expect(reactFlowMockState.fitView).toHaveBeenCalledTimes(1))
  })
})
