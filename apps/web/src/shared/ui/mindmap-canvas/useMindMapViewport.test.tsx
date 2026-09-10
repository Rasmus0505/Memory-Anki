import { act, renderHook, waitFor } from '@testing-library/react'
import type { Node, Viewport } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapNode } from './adapter'
import {
  MINDMAP_BRANCH_FIT_PADDING,
  MINDMAP_DEFAULT_ZOOM,
  MINDMAP_FIT_MAX_ZOOM,
  MINDMAP_FIT_MIN_ZOOM,
  MINDMAP_FIT_PADDING,
  MINDMAP_FOCUS_FIT_PADDING,
  MINDMAP_MOBILE_FIT_MAX_ZOOM,
  MINDMAP_MOBILE_FIT_MIN_ZOOM,
  MINDMAP_MOBILE_GUIDED_FIT_PADDING,
} from './mindMapViewportConfig'
import { useMindMapViewport } from './useMindMapViewport'

const reactFlowMock = vi.hoisted(() => ({
  fitView: vi.fn(),
  getViewport: vi.fn(() => ({ x: 120, y: -48, zoom: 0.5 })),
  setCenter: vi.fn(),
  setViewport: vi.fn(() => Promise.resolve(true)),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}))

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => reactFlowMock,
}))

function buildProps(overrides: Partial<Parameters<typeof useMindMapViewport>[0]> = {}) {
  const controlledViewport: Viewport = { x: 120, y: -48, zoom: 0.5 }
  return {
    canvasRef: { current: null },
    controlledViewport,
    onControlledViewportChange: vi.fn(),
    graphNodes: [],
    nodes: [] as Node[],
    measuredNodeSizesRef: { current: new Map() },
    isDraggingNodeRef: { current: false },
    focusMode: false,
    readonly: false,
    mobileViewPolicy: 'map' as const,
    contentChangeViewportPolicy: 'preserve' as const,
    sceneTransitionKey: null,
    viewCommand: null,
    hostRefreshEpoch: 0,
    setNodeSizeVersion: vi.fn(),
    ...overrides,
  }
}

describe('useMindMapViewport preferred zoom', () => {
  it('applies an external preference to zoom only and keeps the local pan', () => {
    const onControlledViewportChange = vi.fn()
    const props = buildProps({ preferredZoom: 0.86, onControlledViewportChange })
    const { rerender } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    expect(onControlledViewportChange).toHaveBeenCalledWith({ x: 120, y: -48, zoom: 0.86 })
    expect(reactFlowMock.setViewport).toHaveBeenCalledWith(
      { x: 120, y: -48, zoom: 0.86 },
      { duration: 0 },
    )

    onControlledViewportChange.mockClear()
    rerender({ ...props, preferredZoom: 1.4 })

    expect(onControlledViewportChange).toHaveBeenCalledWith({ x: 120, y: -48, zoom: 1.4 })
  })

  it('clamps external preferences and ignores unsafe values', () => {
    const onControlledViewportChange = vi.fn()
    const props = buildProps({ preferredZoom: 0.01, onControlledViewportChange })
    const { rerender } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    expect(onControlledViewportChange).toHaveBeenCalledWith({ x: 120, y: -48, zoom: 0.12 })
    onControlledViewportChange.mockClear()
    rerender({ ...props, preferredZoom: Number.NaN })
    expect(onControlledViewportChange).not.toHaveBeenCalled()
  })

  it('reports only a user gesture that changes zoom', () => {
    const onUserZoomChange = vi.fn()
    const props = buildProps({ onUserZoomChange })
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })
    const gestureStart: Viewport = { x: 120, y: -48, zoom: 0.5 }
    const gestureEnd: Viewport = { x: 90, y: -20, zoom: 0.72 }

    act(() => {
      result.current.handleMoveStart(new MouseEvent('pointerdown'), gestureStart)
      result.current.handleMoveEnd(new MouseEvent('pointerup'), gestureEnd)
    })
    expect(onUserZoomChange).toHaveBeenCalledTimes(1)
    expect(onUserZoomChange).toHaveBeenCalledWith(0.72)

    onUserZoomChange.mockClear()
    act(() => {
      result.current.handleMoveStart(new MouseEvent('pointerdown'), gestureEnd)
      result.current.handleMoveEnd(new MouseEvent('pointerup'), { ...gestureEnd, x: 40, y: 12 })
    })
    expect(onUserZoomChange).not.toHaveBeenCalled()

    act(() => {
      result.current.handleMoveEnd(null, { ...gestureEnd, zoom: 0.91 })
    })
    expect(onUserZoomChange).not.toHaveBeenCalled()
  })

  it('reports explicit zoom controls immediately without treating them as a camera command', () => {
    const onUserZoomChange = vi.fn()
    const props = buildProps({ onUserZoomChange })
    reactFlowMock.getViewport.mockReturnValue({ x: 120, y: -48, zoom: 0.5 })
    reactFlowMock.zoomIn.mockReturnValue(Promise.resolve(true))
    reactFlowMock.zoomOut.mockReturnValue(Promise.resolve(true))
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    act(() => result.current.zoomInCanvas())
    expect(onUserZoomChange).toHaveBeenCalledWith(0.6)
    act(() => result.current.zoomOutCanvas())
    expect(onUserZoomChange).toHaveBeenLastCalledWith(0.4166666666666667)
  })

  it('does not report programmatic fit commands as a user preference change', async () => {
    const onUserZoomChange = vi.fn()
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    })
    const props = buildProps({
      canvasRef: { current: host },
      graphNodes: [{
        id: 'root',
        type: 'chapter',
        label: 'Root',
        originalId: 1,
        parentId: null,
        metadata: {},
      }],
      nodes: [{ id: 'root', position: { x: 0, y: 0 }, data: {}, type: 'mindmap' }],
      viewCommand: { type: 'fit', nonce: 1 },
      onUserZoomChange,
    })

    renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    expect(onUserZoomChange).not.toHaveBeenCalled()
    expect(reactFlowMock.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: MINDMAP_FIT_PADDING,
      minZoom: MINDMAP_FIT_MIN_ZOOM,
      maxZoom: MINDMAP_FIT_MAX_ZOOM,
    }))
  })
})

function canvasHost() {
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  })
  return { current: host }
}

function flowNode(id: string, x: number, y: number) {
  return { id, position: { x, y }, data: {}, type: 'mindmap', width: 100, height: 40 }
}

function graphNode(id: string, parentId: string | null): MindMapNode {
  return {
    id,
    type: 'chapter',
    label: id,
    originalId: 1,
    parentId,
    metadata: {},
  }
}

describe('useMindMapViewport scene transition', () => {
  beforeEach(() => {
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()
    reactFlowMock.getViewport.mockClear()
    reactFlowMock.getViewport.mockReturnValue({ x: 120, y: -48, zoom: 0.5 })
  })

  it('re-centers the previous center card without fitting when sceneTransitionFit is false', async () => {
    const sizes = new Map([
      ['root', { width: 100, height: 40 }],
      ['child', { width: 100, height: 40 }],
    ])
    const nodes = [flowNode('root', 0, 0), flowNode('child', 510, 676)]
    const graphNodes = [graphNode('root', null), graphNode('child', 'root')]
    const props = buildProps({
      canvasRef: canvasHost(),
      graphNodes,
      nodes,
      measuredNodeSizesRef: { current: sizes },
      sceneTransitionKey: 'review',
      sceneTransitionFit: false,
    })
    const { rerender } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    await waitFor(() => expect(reactFlowMock.getViewport).toHaveBeenCalled())
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()

    rerender({
      ...props,
      sceneTransitionKey: 'edit',
      nodes: [flowNode('root', 0, 0), flowNode('child', 400, 400)],
    })

    await waitFor(() => expect(reactFlowMock.setCenter).toHaveBeenCalled())
    expect(reactFlowMock.setCenter).toHaveBeenCalledWith(
      450,
      420,
      expect.objectContaining({ duration: 180, zoom: undefined }),
    )
    expect(reactFlowMock.fitView).not.toHaveBeenCalled()
  })

  it('fits the graph when sceneTransitionFit is true', async () => {
    const nodes = [flowNode('root', 0, 0), flowNode('child', 510, 676)]
    const props = buildProps({
      canvasRef: canvasHost(),
      graphNodes: [graphNode('root', null), graphNode('child', 'root')],
      nodes,
      measuredNodeSizesRef: { current: new Map([
        ['root', { width: 100, height: 40 }],
        ['child', { width: 100, height: 40 }],
      ]) },
      sceneTransitionKey: 'review',
      sceneTransitionFit: true,
    })
    const { rerender } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })
    await waitFor(() => expect(reactFlowMock.getViewport).toHaveBeenCalled())
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()

    rerender({
      ...props,
      sceneTransitionKey: 'edit',
      nodes: [flowNode('root', 20, 20), flowNode('child', 400, 400)],
    })

    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    expect(reactFlowMock.setCenter).not.toHaveBeenCalled()
  })

  it('falls back to the host unit anchor when the previous center card is gone', async () => {
    const sizes = new Map([
      ['root', { width: 100, height: 40 }],
      ['child', { width: 100, height: 40 }],
      ['unit', { width: 100, height: 40 }],
    ])
    const reviewNodes = [flowNode('root', 0, 0), flowNode('child', 510, 676)]
    const props = buildProps({
      canvasRef: canvasHost(),
      graphNodes: [graphNode('root', null), graphNode('child', 'ghost')],
      nodes: reviewNodes,
      measuredNodeSizesRef: { current: sizes },
      sceneTransitionKey: 'review',
      sceneTransitionFit: false,
      sceneTransitionFallbackNodeId: 'unit',
    })
    const { rerender } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })
    await waitFor(() => expect(reactFlowMock.getViewport).toHaveBeenCalled())
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()

    rerender({
      ...props,
      sceneTransitionKey: 'edit',
      graphNodes: [graphNode('root', null), graphNode('unit', 'root')],
      nodes: [flowNode('root', 0, 0), flowNode('unit', 200, 200)],
    })

    await waitFor(() => expect(reactFlowMock.setCenter).toHaveBeenCalled())
    expect(reactFlowMock.setCenter).toHaveBeenCalledWith(
      250,
      220,
      expect.objectContaining({ duration: 180, zoom: undefined }),
    )
    expect(reactFlowMock.fitView).not.toHaveBeenCalled()
  })
})

describe('useMindMapViewport fit padding', () => {
  beforeEach(() => {
    reactFlowMock.fitView.mockClear()
  })

  it('uses a tighter desktop fit and keeps guided padding', async () => {
    const props = buildProps({
      canvasRef: canvasHost(),
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
      viewCommand: { type: 'fit', nonce: 11 },
    })
    renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })
    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    expect(reactFlowMock.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: MINDMAP_FIT_PADDING,
      maxZoom: MINDMAP_FIT_MAX_ZOOM,
    }))
  })

  it('keeps focus-mode padding tighter than the default fit', async () => {
    const props = buildProps({
      canvasRef: canvasHost(),
      focusMode: true,
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
      viewCommand: { type: 'fit', nonce: 12 },
    })
    renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })
    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    expect(reactFlowMock.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: MINDMAP_FOCUS_FIT_PADDING,
      maxZoom: MINDMAP_FIT_MAX_ZOOM,
    }))
  })

  it('keeps mobile guided fit padding and zoom', async () => {
    const props = buildProps({
      canvasRef: canvasHost(),
      readonly: true,
      mobileViewPolicy: 'guided',
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
      viewCommand: { type: 'fit', nonce: 13 },
    })
    renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })
    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    expect(reactFlowMock.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: MINDMAP_MOBILE_GUIDED_FIT_PADDING,
      minZoom: MINDMAP_MOBILE_FIT_MIN_ZOOM,
      maxZoom: MINDMAP_MOBILE_FIT_MAX_ZOOM,
    }))
  })

  it('fits a branch with the tighter branch padding', async () => {
    const props = buildProps({
      canvasRef: canvasHost(),
      graphNodes: [graphNode('root', null), graphNode('child', 'root')],
      nodes: [flowNode('root', 0, 0), flowNode('child', 120, 80)],
    })
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })
    await waitFor(() => expect(result.current.isCanvasReady).toBe(true))
    reactFlowMock.fitView.mockClear()
    act(() => {
      result.current.fitNodesInView(['child'])
    })
    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    expect(reactFlowMock.fitView).toHaveBeenCalledWith(expect.objectContaining({
      padding: MINDMAP_BRANCH_FIT_PADDING,
      maxZoom: MINDMAP_FIT_MAX_ZOOM,
    }))
  })
})

describe('useMindMapViewport first canvas size', () => {
  beforeEach(() => {
    reactFlowMock.fitView.mockClear()
  })

  it('fits once when canvas size goes from 0 to a positive value', async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    })
    let width = 0
    let height = 0
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, get: () => height },
    })
    const props = buildProps({
      canvasRef: { current: host },
      controlledViewport: { x: 4, y: 18, zoom: MINDMAP_DEFAULT_ZOOM },
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
    })
    try {
      const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
        initialProps: props,
      })
      expect(result.current.isCanvasReady).toBe(false)
      expect(reactFlowMock.fitView).not.toHaveBeenCalled()

      width = 800
      height = 600
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      await waitFor(() => expect(result.current.isCanvasReady).toBe(true))
      await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalledTimes(1))

      act(() => {
        result.current.handleMoveStart(new MouseEvent('pointerdown'), {
          x: 4,
          y: 18,
          zoom: MINDMAP_DEFAULT_ZOOM,
        })
        result.current.handleMoveEnd(new MouseEvent('pointerup'), {
          x: 40,
          y: 12,
          zoom: 1.2,
        })
      })
      reactFlowMock.fitView.mockClear()
      width = 1024
      height = 720
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(reactFlowMock.fitView).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      })
    }
  })

  it('does not steal a restored camera when canvas size becomes positive', async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | null = null
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    })
    let width = 0
    let height = 0
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, get: () => height },
    })
    const props = buildProps({
      canvasRef: { current: host },
      controlledViewport: { x: 146, y: -83, zoom: 0.78 },
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
    })
    try {
      renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })
      width = 800
      height = 600
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      await waitFor(() => expect(reactFlowMock.setViewport).toHaveBeenCalled())
      expect(reactFlowMock.fitView).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      })
    }
  })
})
