import { act, renderHook } from '@testing-library/react'
import type { Node, Viewport } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindMapNode } from './adapter'
import { MINDMAP_WHEEL_PAN_OWED_GRACE_MS } from './mindMapViewportConfig'
import { useMindMapViewport } from './useMindMapViewport'

/**
 * Wheel panning under `contentChangeViewportPolicy: 'preserve'`.
 *
 * In preserve mode the canvas deliberately ignores camera reports that React
 * Flow generates on its own, so a layout pass cannot move the user's camera.
 * A wheel pan is not one of those: it is user intent and must survive.
 *
 * React Flow does not reliably bracket a wheel pan with moveStart/moveEnd, so its
 * camera report can arrive after the short gesture window. Classifying on that
 * window alone silently dropped real pans â€?the controlled viewport kept the
 * pre-wheel camera and the next re-render (editing a card) snapped the map back
 * under the pointer.
 *
 * These tests pin BOTH directions: a late wheel report must commit, and
 * unattributed drift past the grace must still be dropped. Without the second
 * half, "fixing" the first would quietly delete the preserve guarantee.
 */

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

const INITIAL_VIEWPORT: Viewport = { x: 120, y: -48, zoom: 0.5 }
const PANNED_VIEWPORT: Viewport = { x: 400, y: -300, zoom: 0.5 }

/** A clock the test advances explicitly, so window/grace boundaries are exact. */
let clock = 1_000

/**
 * Advance the mocked `performance.now()` and the pending timers together.
 *
 * The hook tracks a wheel with both a `performance.now()` deadline and a
 * `setTimeout` that ends the gesture. Moving only one of them would test a state
 * that cannot occur, so they are always stepped in lockstep here.
 */
function advance(ms: number) {
  clock += ms
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function buildProps(overrides: Partial<Parameters<typeof useMindMapViewport>[0]> = {}) {
  return {
    canvasRef: { current: null },
    controlledViewport: INITIAL_VIEWPORT,
    onControlledViewportChange: vi.fn(),
    graphNodes: [] as MindMapNode[],
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

/** Queue animation frames instead of running them, so a test can flush a frame. */
function installFrames() {
  const queued = new Map<number, FrameRequestCallback>()
  const originalRaf = window.requestAnimationFrame
  const originalCancel = window.cancelAnimationFrame
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
  return {
    flush: () => {
      const batch = [...queued.values()]
      queued.clear()
      act(() => {
        batch.forEach((callback) => callback(0))
      })
    },
    restore: () => {
      window.requestAnimationFrame = originalRaf
      window.cancelAnimationFrame = originalCancel
    },
  }
}

function mountViewport(host: HTMLDivElement, onControlledViewportChange = vi.fn()) {
  return renderHook((props) => useMindMapViewport(props), {
    initialProps: buildProps({ canvasRef: { current: host }, onControlledViewportChange }),
  })
}

function wheel(host: HTMLDivElement) {
  act(() => {
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  clock = 1_000
  vi.useFakeTimers()
  reactFlowMock.setViewport.mockClear()
  reactFlowMock.fitView.mockClear()
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('preserve mode wheel panning', () => {
  it('commits a wheel pan reported inside the gesture window', () => {
    const host = document.createElement('div') as HTMLDivElement
    const onControlledViewportChange = vi.fn()
    const { result } = mountViewport(host, onControlledViewportChange)

    wheel(host)
    act(() => {
      result.current.handleViewportChange(PANNED_VIEWPORT)
    })

    expect(onControlledViewportChange).toHaveBeenCalledWith(PANNED_VIEWPORT)
  })

  it('commits a wheel pan reported after the gesture window but inside the grace', () => {
    const host = document.createElement('div') as HTMLDivElement
    const onControlledViewportChange = vi.fn()
    const { result } = mountViewport(host, onControlledViewportChange)

    wheel(host)
    // Past the 280 ms gesture window, still within the owed grace.
    advance(400)

    act(() => {
      result.current.handleViewportChange(PANNED_VIEWPORT)
    })

    expect(onControlledViewportChange).toHaveBeenCalledWith(PANNED_VIEWPORT)
  })

  it('still drops unattributed drift once the grace has lapsed', () => {
    const host = document.createElement('div') as HTMLDivElement
    const onControlledViewportChange = vi.fn()
    const { result } = mountViewport(host, onControlledViewportChange)

    wheel(host)
    advance(MINDMAP_WHEEL_PAN_OWED_GRACE_MS + 500)

    // No user gesture is live any more, so this is React-Flow-driven drift.
    // Committing it would break the preserve guarantee this mode exists for.
    act(() => {
      result.current.handleViewportChange(PANNED_VIEWPORT)
    })

    expect(onControlledViewportChange).not.toHaveBeenCalled()
  })

  it('does not pull the camera back to the pre-wheel position on a later graph change', () => {
    const host = document.createElement('div') as HTMLDivElement
    const frames = installFrames()
    const onControlledViewportChange = vi.fn()
    try {
      const { result, rerender } = mountViewport(host, onControlledViewportChange)

      wheel(host)
      advance(400)
      act(() => {
        result.current.handleViewportChange(PANNED_VIEWPORT)
      })

      onControlledViewportChange.mockClear()
      reactFlowMock.setViewport.mockClear()

      // Editing a card re-renders the graph, which triggers a preserve restore.
      rerender(buildProps({
        canvasRef: { current: host },
        onControlledViewportChange,
        graphNodes: [{ id: 'a', parentId: null, text: 'A', children: [] } as unknown as MindMapNode],
      }))
      frames.flush()

      // Reverting to the pre-wheel camera is the "snap back" the user feels.
      expect(onControlledViewportChange).not.toHaveBeenCalledWith(INITIAL_VIEWPORT)
    } finally {
      frames.restore()
    }
  })
})
