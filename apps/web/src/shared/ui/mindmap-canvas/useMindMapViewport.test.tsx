import { act, renderHook, waitFor } from '@testing-library/react'
import type { Node, Viewport } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
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
  })
})
