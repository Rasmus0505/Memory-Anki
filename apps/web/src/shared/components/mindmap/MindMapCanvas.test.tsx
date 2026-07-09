import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MindMapCanvas } from './MindMapCanvas'
import type { GraphData } from './adapter'

const reactFlowMockState = vi.hoisted(() => ({
  nextProviderId: 1,
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
    ReactFlow: ({ nodes }: { nodes: Array<{ id: string; data?: Record<string, unknown> }> }) => (
      <div data-testid="react-flow">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid={`node-${node.id}`}
            data-long-press={node.data?.onTouchLongPress ? 'yes' : 'no'}
            onClick={() =>
              (node.data?.onTouchLongPress as
                | ((nodeId: string, point: { x: number; y: number }) => void)
                | undefined)?.(node.id, { x: 0, y: 0 })
            }
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
      fitView: vi.fn(),
      setCenter: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
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

describe('MindMapCanvas recovery', () => {
  let widthSpy: ReturnType<typeof vi.spyOn>
  let heightSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    reactFlowMockState.nextProviderId = 1
    widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  })

  afterEach(() => {
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
})
