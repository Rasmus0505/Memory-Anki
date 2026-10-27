import { act, renderHook, waitFor } from '@testing-library/react'
import type { Viewport } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MINDMAP_BRANCH_FIT_PADDING,
  MINDMAP_FIT_MAX_ZOOM,
  MINDMAP_FIT_MIN_ZOOM,
  MINDMAP_FIT_PADDING,
  MINDMAP_FOCUS_FIT_PADDING,
  MINDMAP_MOBILE_FIT_MAX_ZOOM,
  MINDMAP_MOBILE_FIT_MIN_ZOOM,
  MINDMAP_MOBILE_GUIDED_FIT_PADDING,
} from './mindMapViewportConfig'
import { useMindMapViewport } from './useMindMapViewport'
import { buildProps, canvasHost, flowNode, graphNode } from './useMindMapViewport.testHelpers'

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

function phoneCanvasHost() {
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 375 },
    clientHeight: { configurable: true, value: 700 },
  })
  return { current: host }
}

describe('useMindMapViewport preferred zoom', () => {
  beforeEach(() => {
    reactFlowMock.fitView.mockClear()
    reactFlowMock.setCenter.mockClear()
  })

  it('applies the host phone zoom on a narrow read-only review canvas', () => {
    // Freestyle keeps a separate phone zoom, so a narrow review canvas may apply
    // the learner's own value; the per-card fit must not throw it away.
    const onControlledViewportChange = vi.fn()
    const props = buildProps({
      canvasRef: phoneCanvasHost(),
      controlledViewport: { x: 4, y: 18, zoom: 0.5 },
      onControlledViewportChange,
      readonly: true,
      mobileViewPolicy: 'auto',
      preferredZoom: 0.9,
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
    })
    renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })

    expect(onControlledViewportChange).toHaveBeenCalledWith({ x: 4, y: 18, zoom: 0.9 })
  })

  it('leaves the phone fit in charge when the host has no phone zoom yet', async () => {
    reactFlowMock.fitView.mockClear()
    const onControlledViewportChange = vi.fn()
    const props = buildProps({
      canvasRef: phoneCanvasHost(),
      // No host preference: the canvas starts on its default camera.
      controlledViewport: { x: 4, y: 18, zoom: 1 },
      onControlledViewportChange,
      readonly: true,
      mobileViewPolicy: 'auto',
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
    })
    renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })

    await waitFor(() => expect(reactFlowMock.fitView).toHaveBeenCalled())
    // Only the fit writes the camera; no host zoom is forced back.
    expect(onControlledViewportChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 1 }),
    )
  })

  it('keeps the guided host fit in charge of a preferred zoom', () => {
    const onControlledViewportChange = vi.fn()
    const props = buildProps({
      canvasRef: phoneCanvasHost(),
      controlledViewport: { x: 4, y: 18, zoom: 0.5 },
      onControlledViewportChange,
      readonly: true,
      mobileViewPolicy: 'guided',
      preferredZoom: 1.4,
      graphNodes: [graphNode('root', null)],
      nodes: [flowNode('root', 0, 0)],
    })
    renderHook((nextProps) => useMindMapViewport(nextProps), { initialProps: props })

    expect(onControlledViewportChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 1.4 }),
    )
  })

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

  it('keeps a wheel zoom gesture start so a second start with the zoomed camera still reports', () => {
    // React Flow's pan-on-scroll ctrl/pinch path reports the wheel gesture start
    // twice: first with the pre-zoom camera, then with the already-zoomed one.
    // Letting the second report overwrite the gesture start made move-end see no
    // zoom change, so the freestyle shared zoom preference never advanced.
    const onUserZoomChange = vi.fn()
    const props = buildProps({
      onUserZoomChange,
      controlledViewport: { x: 4, y: 18, zoom: 1 },
    })
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })
    const wheel = new WheelEvent('wheel', { ctrlKey: true })

    act(() => {
      result.current.handleMoveStart(wheel, { x: 4, y: 18, zoom: 1 })
      result.current.handleMoveStart(wheel, { x: 4, y: 18, zoom: 1.18 })
      result.current.handleMoveEnd(wheel, { x: 4, y: 18, zoom: 1.18 })
    })

    expect(onUserZoomChange).toHaveBeenCalledTimes(1)
    expect(onUserZoomChange).toHaveBeenCalledWith(1.18)
  })

  it('reports a ctrl-wheel zoom whose start report already carries the zoomed camera', () => {
    const canvas = document.createElement('div')
    document.body.appendChild(canvas)
    const onUserZoomChange = vi.fn()
    const props = buildProps({
      canvasRef: { current: canvas },
      onUserZoomChange,
      controlledViewport: { x: 4, y: 18, zoom: 1 },
    })
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    // The capture handler arms the wheel gesture before React Flow reports it.
    act(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })
    act(() => {
      result.current.handleMoveStart(new WheelEvent('wheel', { ctrlKey: true }), { x: 4, y: 18, zoom: 1.18 })
      result.current.handleMoveEnd(new WheelEvent('wheel', { ctrlKey: true }), { x: 4, y: 18, zoom: 1.18 })
    })

    expect(onUserZoomChange).toHaveBeenCalledWith(1.18)
    document.body.removeChild(canvas)
  })

  it('reports a zoom observed during a wheel gesture whose end lands after the wheel timer', () => {
    // Pan-on-scroll closes the wheel gesture after ~280ms, but React Flow's d3
    // wheel-end can land later. The end then re-reads the already-zoomed camera as
    // the "start", so only the report observed during the gesture proves the user
    // zoomed.
    vi.useFakeTimers()
    const canvas = document.createElement('div')
    document.body.appendChild(canvas)
    const onUserZoomChange = vi.fn()
    const props = buildProps({
      canvasRef: { current: canvas },
      onUserZoomChange,
      controlledViewport: { x: 4, y: 18, zoom: 1 },
    })
    const { result } = renderHook((nextProps) => useMindMapViewport(nextProps), {
      initialProps: props,
    })

    act(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
    })
    act(() => {
      result.current.handleViewportChange({ x: 4, y: 18, zoom: 1.3 })
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    act(() => {
      result.current.handleMoveEnd(
        new WheelEvent('wheel', { ctrlKey: true }),
        { x: 4, y: 18, zoom: 1.3 },
      )
    })

    expect(onUserZoomChange).toHaveBeenCalledWith(1.3)
    vi.useRealTimers()
    document.body.removeChild(canvas)
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
