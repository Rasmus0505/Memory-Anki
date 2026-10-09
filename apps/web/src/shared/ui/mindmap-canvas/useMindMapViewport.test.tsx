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

  it('commits a wheel pan that arrives before move-start instead of restoring the old camera', () => {
    const canvas = document.createElement('div')
    const onControlledViewportChange = vi.fn()
    const props = buildProps({
      canvasRef: { current: canvas },
      onControlledViewportChange,
    })
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })
    const panned = { x: 120, y: -180, zoom: 0.5 }

    act(() => {
      result.current.handleViewportChange(panned)
    })
    expect(onControlledViewportChange).not.toHaveBeenCalled()

    act(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
      result.current.handleViewportChange(panned)
    })
    expect(onControlledViewportChange).toHaveBeenCalledWith(panned)
  })

  it('moves the map when a wheel starts on an edit card that blocks drag', () => {
    const canvas = document.createElement('div')
    const card = document.createElement('button')
    card.className = 'nopan'
    canvas.appendChild(card)
    const onControlledViewportChange = vi.fn()
    reactFlowMock.setViewport.mockClear()
    renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: buildProps({
        canvasRef: { current: canvas },
        onControlledViewportChange,
      }),
    })

    act(() => {
      card.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      }))
    })

    expect(onControlledViewportChange).toHaveBeenCalledWith({ x: 120, y: -98, zoom: 0.5 })
    expect(reactFlowMock.setViewport).toHaveBeenCalledWith(
      { x: 120, y: -98, zoom: 0.5 },
      { duration: 0 },
    )
  })

  it('does not turn ctrl-wheel on an edit card into a pan', () => {
    const canvas = document.createElement('div')
    const card = document.createElement('button')
    card.className = 'nowheel nopan'
    canvas.appendChild(card)
    const onControlledViewportChange = vi.fn()
    renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: buildProps({
        canvasRef: { current: canvas },
        onControlledViewportChange,
      }),
    })

    act(() => {
      card.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })

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
  // Short label keeps the typographic size estimate below the measured 100×40 card.
  return { id, position: { x, y }, data: { label: id }, type: 'mindmap', width: 100, height: 40 }
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

  it('cancels the pending first-size fit when a bound node should be centered', () => {
    const queued: FrameRequestCallback[] = []
    const originalRaf = window.requestAnimationFrame
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queued.push(callback)
      return queued.length
    }) as typeof window.requestAnimationFrame
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
      graphNodes: [graphNode('root', null), graphNode('child', 'root')],
      nodes: [flowNode('root', 0, 0), flowNode('child', 510, 676)],
      measuredNodeSizesRef: {
        current: new Map([
          ['root', { width: 100, height: 40 }],
          ['child', { width: 100, height: 40 }],
        ]),
      },
      viewCommand: null,
    })
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()
    try {
      const { rerender, result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
        initialProps: props,
      })
      width = 800
      height = 600
      act(() => {
        resizeCallback?.([], {} as ResizeObserver)
      })
      expect(result.current.isCanvasReady).toBe(true)
      expect(queued.length).toBeGreaterThan(0)
      expect(reactFlowMock.fitView).not.toHaveBeenCalled()

      act(() => {
        rerender({
          ...props,
          viewCommand: { type: 'center', nodeId: 'child', nonce: 4 },
        })
      })
      expect(reactFlowMock.setCenter).toHaveBeenCalledWith(
        560,
        696,
        expect.objectContaining({ duration: 220 }),
      )

      const pending = queued.splice(0)
      act(() => {
        pending.forEach((callback) => callback(0))
      })
      expect(reactFlowMock.fitView).not.toHaveBeenCalled()
    } finally {
      window.requestAnimationFrame = originalRaf
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

describe('useMindMapViewport reveal into view', () => {
  beforeEach(() => {
    reactFlowMock.setViewport.mockClear()
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()
    reactFlowMock.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 })
  })

  function installCanvas() {
    const originalRaf = window.requestAnimationFrame
    const originalCancel = window.cancelAnimationFrame
    const originalResizeObserver = globalThis.ResizeObserver
    const queued = new Map<number, FrameRequestCallback>()
    let nextId = 1
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextId
      nextId += 1
      queued.set(id, callback)
      return id
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = ((id: number) => {
      queued.delete(id)
    }) as typeof window.cancelAnimationFrame
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
    const host = document.createElement('div')
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    })
    return {
      host,
      ready: () => {
        act(() => {
          resizeCallback?.([], {} as ResizeObserver)
        })
      },
      flushFrames: () => {
        const batch = [...queued.values()]
        queued.clear()
        act(() => {
          batch.forEach((callback) => callback(0))
        })
      },
      restore: () => {
        window.requestAnimationFrame = originalRaf
        window.cancelAnimationFrame = originalCancel
        Object.defineProperty(globalThis, 'ResizeObserver', {
          configurable: true,
          writable: true,
          value: originalResizeObserver,
        })
      },
    }
  }

  it('pans the minimum distance to reveal the most clipped card and keeps zoom', () => {
    const canvas = installCanvas()
    const props = buildProps({
      canvasRef: { current: canvas.host },
      controlledViewport: { x: 0, y: 0, zoom: 1 },
      nodes: [flowNode('near', 740, 40), flowNode('far', 900, 40)],
      measuredNodeSizesRef: {
        current: new Map([
          ['near', { width: 100, height: 40 }],
          ['far', { width: 100, height: 40 }],
        ]),
      },
      viewCommand: { type: 'reveal', nodeIds: ['near', 'far'], nonce: 1 },
    })
    try {
      renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })
      canvas.ready()
      reactFlowMock.setViewport.mockClear()
      canvas.flushFrames()
      canvas.flushFrames()
      expect(reactFlowMock.setCenter).not.toHaveBeenCalled()
      expect(reactFlowMock.setViewport).toHaveBeenCalledWith(
        { x: 800 - 32 - 1000, y: 0, zoom: 1 },
        { duration: 200 },
      )
    } finally {
      canvas.restore()
    }
  })

  it('does not pan when the revealed card is already fully inside the padded viewport', () => {
    const canvas = installCanvas()
    const props = buildProps({
      canvasRef: { current: canvas.host },
      controlledViewport: { x: 0, y: 0, zoom: 1 },
      nodes: [flowNode('visible', 80, 80)],
      measuredNodeSizesRef: {
        current: new Map([['visible', { width: 100, height: 40 }]]),
      },
      viewCommand: { type: 'reveal', nodeIds: ['visible'], nonce: 2 },
    })
    try {
      renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })
      canvas.ready()
      reactFlowMock.setViewport.mockClear()
      canvas.flushFrames()
      canvas.flushFrames()
      expect(reactFlowMock.setViewport).not.toHaveBeenCalled()
    } finally {
      canvas.restore()
    }
  })
})
