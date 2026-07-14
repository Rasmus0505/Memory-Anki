import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapEditorSurface } from './MindMapEditorSurface'
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
    MiniMap: () => null,
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
              data-long-press={node.data?.onTouchLongPress ? 'yes' : 'no'}
              data-position={String(node.position?.x ?? 0) + ',' + String(node.position?.y ?? 0)}
              onClick={(event) => {
                void onNodeClick?.(event, node)
                const touchLongPress = node.data?.onTouchLongPress as
                  | ((nodeId: string, point: { x: number; y: number }) => void)
                  | undefined
                touchLongPress?.(node.id, { x: 0, y: 0 })
              }}
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

const editorState: MindMapEditorState = {
  editor_doc: {
    root: {
      data: { text: '宫殿', uid: 'frame-root' },
      children: [{ data: { text: '知识点', uid: 'frame-child' }, children: [] }],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

function ControlledMindMapEditorSurface() {
  const [state, setState] = useState(editorState)
  return <MindMapEditorSurface editorState={state} onEditorStateChange={setState} />
}

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

const siblingGraphData: GraphData = {
  nodes: [
    ...graphData.nodes,
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

const relabeledGraphData: GraphData = {
  ...expandedGraphData,
  nodes: expandedGraphData.nodes.map((node) =>
    node.id === 'root'
      ? { ...node, label: 'A much longer revealed root label that changes measured layout width' }
      : node,
  ),
}

describe('MindMapCanvas recovery', () => {
  let widthSpy: ReturnType<typeof vi.spyOn>
  let heightSpy: ReturnType<typeof vi.spyOn>
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame
  let originalResizeObserver: typeof globalThis.ResizeObserver

  beforeEach(() => {
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    originalResizeObserver = globalThis.ResizeObserver
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
    reactFlowMockState.setViewport.mockClear()
    reactFlowMockState.getViewport.mockImplementation(() => ({ ...reactFlowMockState.viewport }))
    reactFlowMockState.setViewport.mockImplementation((viewport: { x: number; y: number; zoom: number }) => {
      reactFlowMockState.viewport = { ...viewport }
      return Promise.resolve(true)
    })
    reactFlowMockState.viewport = { x: 4, y: 18, zoom: 0.99 }
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
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    })
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

  it('measures the canvas host directly instead of subtracting a toolbar height', () => {
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

    const viewport = screen.getByTestId('mindmap-canvas-viewport-host').querySelector('[style*="width"]') as HTMLElement
    expect(viewport.style.width).toBe('800px')
    expect(viewport.style.height).toBe('600px')
  })

  it('keeps card selection separate from editing across the full frame and canvas flow', async () => {
    render(<ControlledMindMapEditorSurface />)
    const child = await screen.findByRole('button', { name: '知识点' })

    fireEvent.click(child)
    expect(screen.queryByRole('textbox', { name: '编辑节点文本' })).toBeNull()

    child.focus()
    fireEvent.keyDown(child, { key: 'Tab' })
    const committedNewNode = await screen.findByRole('button', { name: '新知识点' })
    expect(screen.queryByRole('textbox', { name: '编辑节点文本' })).toBeNull()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '知识点' }))
    })

    fireEvent.doubleClick(committedNewNode)
    const reopenedEditor = await screen.findByRole('textbox', { name: '编辑节点文本' })
    fireEvent.change(reopenedEditor, { target: { value: '已更新知识点' } })
    fireEvent.click(screen.getByRole('button', { name: '宫殿' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已更新知识点' })).toBeTruthy()
      expect(screen.queryByRole('textbox', { name: '编辑节点文本' })).toBeNull()
    })
  })

  it('enables touch long press actions in practice mode even when pointer media detection is unavailable', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: false,
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

  it('keeps the desktop edit context menu available outside practice mode', () => {
    render(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        onNodeContextAction={vi.fn()}
      />,
    )

    fireEvent.contextMenu(screen.getByTestId('node-root'), {
      clientX: 120,
      clientY: 160,
    })

    expect(screen.getByRole('button', { name: '添加子知识点 (Tab)' })).toBeTruthy()
  })

  it('runs the practice context action without leaving a stale node menu open', () => {
    const onNodeContextAction = vi.fn()

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

    fireEvent.contextMenu(screen.getByTestId('node-root'), {
      clientX: 120,
      clientY: 160,
    })

    expect(onNodeContextAction).toHaveBeenCalledWith('root')
    expect(screen.queryByRole('button', { name: '隐藏这个分支' })).toBeNull()
    expect(screen.getByTestId('react-flow').textContent).toContain('root')
  })

  it('runs the practice context action when right-clicking the node text', () => {
    const onNodeContextAction = vi.fn()

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

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Root' }), {
      clientX: 120,
      clientY: 160,
    })

    expect(onNodeContextAction).toHaveBeenCalledWith('root')
    expect(screen.queryByRole('button', { name: '隐藏这个分支' })).toBeNull()
  })

  it('preserves guided mobile node clicks unless centering is explicitly requested', () => {
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

    fireEvent.click(screen.getByTestId('node-root'))

    expect(reactFlowMockState.setCenter).not.toHaveBeenCalled()
    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()

    rerender(
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        mobileViewPolicy="guided"
        nodeClickViewportPolicy="guided-center"
      />,
    )

    fireEvent.click(screen.getByTestId('node-root'))

    expect(reactFlowMockState.setCenter).toHaveBeenCalled()
    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()
  })

  it('keeps guided mobile content changes from fitting the viewport', async () => {
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

    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()

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

  it('reflows measured practice cards instead of preserving stale overlapping coordinates', async () => {
    render(
      <MindMapCanvas
        graphData={siblingGraphData}
        selectedNodeId="child-b"
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        practiceModeActive
        mobileViewPolicy="guided"
        nodeClickViewportPolicy="preserve"
        contentChangeViewportPolicy="preserve"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('node-child-b')).toBeTruthy())
    const initialBottomPosition = screen.getByTestId('node-child-b').getAttribute('data-position')
    const measuredNode = reactFlowMockState.nodes.find((node) => node.id === 'child-a')
    const onMeasure = measuredNode?.data?.onMeasure as
      | ((nodeId: string, size: { width: number; height: number }) => void)
      | undefined

    expect(onMeasure).toBeTypeOf('function')
    reactFlowMockState.fitView.mockClear()
    reactFlowMockState.setViewport.mockClear()
    act(() => {
      onMeasure?.('child-a', { width: 220, height: 160 })
    })

    await waitFor(() => {
      expect(screen.getByTestId('node-child-b').getAttribute('data-position')).not.toBe(initialBottomPosition)
    })

    const [, upperY] = screen.getByTestId('node-child-a').getAttribute('data-position')!.split(',').map(Number)
    const [, lowerY] = screen.getByTestId('node-child-b').getAttribute('data-position')!.split(',').map(Number)
    expect(lowerY).toBeGreaterThanOrEqual(upperY + 160 + 18)
    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()
    expect(reactFlowMockState.setCenter).not.toHaveBeenCalled()
  })

  it('restores programmatic viewport movement during practice card changes', async () => {
    const props = {
      selectedNodeId: null,
      onNodeSelect: vi.fn(),
      onAddChild: vi.fn(),
      onAddSibling: vi.fn(),
      onDelete: vi.fn(),
      practiceModeActive: true,
      mobileViewPolicy: 'map' as const,
      nodeClickViewportPolicy: 'preserve' as const,
      contentChangeViewportPolicy: 'preserve' as const,
    }
    const { rerender } = render(
      <MindMapCanvas graphData={expandedGraphData} {...props} />,
    )

    await waitFor(() => expect(reactFlowMockState.getViewport).toHaveBeenCalled())
    reactFlowMockState.setViewport.mockClear()
    reactFlowMockState.viewport = { x: 128, y: -72, zoom: 0.84 }

    rerender(<MindMapCanvas graphData={relabeledGraphData} {...props} />)

    await waitFor(() =>
      expect(reactFlowMockState.setViewport).toHaveBeenCalledWith(
        { x: 4, y: 18, zoom: 0.99 },
        { duration: 0 },
      ),
    )
  })

  it('keeps the user viewport after the React Flow host is rebuilt', async () => {
    let hostResizeCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      private readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        if (target.getAttribute('data-testid') === 'mindmap-canvas-viewport-host') {
          hostResizeCallback = this.callback
        }
      }

      disconnect() {}
      unobserve() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    })

    const { rerender } = render(
      <MindMapCanvas
        graphData={expandedGraphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        contentChangeViewportPolicy="preserve"
      />,
    )

    const userViewport = { x: 146, y: -83, zoom: 0.78 }
    await waitFor(() => expect(reactFlowMockState.reactFlowProps?.viewport).toBeTruthy())
    const moveStart = reactFlowMockState.reactFlowProps?.onMoveStart as
      | ((event: MouseEvent, viewport: typeof userViewport) => void)
      | undefined
    const viewportChange = reactFlowMockState.reactFlowProps?.onViewportChange as
      | ((viewport: typeof userViewport) => void)
      | undefined
    const moveEnd = reactFlowMockState.reactFlowProps?.onMoveEnd as
      | ((event: MouseEvent, viewport: typeof userViewport) => void)
      | undefined

    act(() => {
      const event = new MouseEvent('mousedown')
      moveStart?.(event, userViewport)
      viewportChange?.(userViewport)
      moveEnd?.(event, userViewport)
    })

    await waitFor(() =>
      expect(reactFlowMockState.reactFlowProps?.viewport).toEqual(userViewport),
    )

    act(() => {
      viewportChange?.({ x: 0, y: 0, zoom: 1 })
    })
    expect(reactFlowMockState.reactFlowProps?.viewport).toEqual(userViewport)

    widthSpy.mockReturnValue(0)
    heightSpy.mockReturnValue(0)
    act(() => {
      hostResizeCallback?.([], {} as ResizeObserver)
    })
    expect(screen.getByTestId('react-flow')).toBeTruthy()
    expect(reactFlowMockState.reactFlowProps?.viewport).toEqual(userViewport)

    widthSpy.mockReturnValue(1024)
    heightSpy.mockReturnValue(720)
    act(() => {
      hostResizeCallback?.([], {} as ResizeObserver)
    })
    expect(reactFlowMockState.reactFlowProps?.viewport).toEqual(userViewport)

    rerender(
      <MindMapCanvas
        graphData={relabeledGraphData}
        selectedNodeId={null}
        onNodeSelect={vi.fn()}
        onAddChild={vi.fn()}
        onAddSibling={vi.fn()}
        onDelete={vi.fn()}
        contentChangeViewportPolicy="preserve"
      />,
    )
    expect(reactFlowMockState.reactFlowProps?.viewport).toEqual(userViewport)

    const providerBeforeRefresh = screen.getByTestId('react-flow-provider').dataset.providerId

    fireEvent.click(screen.getByTitle('刷新脑图'))

    await waitFor(() =>
      expect(screen.getByTestId('react-flow-provider').dataset.providerId).not.toBe(
        providerBeforeRefresh,
      ),
    )
    expect(reactFlowMockState.reactFlowProps?.viewport).toEqual(userViewport)
  })

  it('keeps the default guided mobile viewport stable across content changes', async () => {
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

    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()

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

    await waitFor(() => expect(screen.getByTestId('node-child')).toBeTruthy())
    expect(reactFlowMockState.fitView).not.toHaveBeenCalled()
  })
})
