import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MINDMAP_DEFAULT_ZOOM } from './mindMapViewportConfig'
import { useMindMapViewport } from './useMindMapViewport'
import { buildProps, flowNode, graphNode } from './useMindMapViewport.testHelpers'

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
