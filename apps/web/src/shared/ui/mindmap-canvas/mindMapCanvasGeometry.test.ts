import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  anyNodeIntersectsViewport,
  findNearestNodeIdToViewportCenter,
  getViewportCenterFlowPoint,
  nodeIntersectsViewport,
} from './mindMapCanvasGeometry'

function node(id: string, x: number, y: number, width = 100, height = 40): Node {
  return {
    id,
    position: { x, y },
    data: {},
    width,
    height,
  }
}

describe('mindMapCanvasGeometry viewport center', () => {
  it('converts screen center into flow coordinates', () => {
    expect(
      getViewportCenterFlowPoint({ x: 10, y: 20, zoom: 1 }, { width: 200, height: 100 }),
    ).toEqual({ x: 90, y: 30 })
  })

  it('finds the node nearest the viewport center', () => {
    const nodes = [
      node('a', 0, 0),
      node('b', 200, 0),
      node('c', 80, 20),
    ]
    // Canvas 400x200, identity viewport → center flow point (200, 100)
    // Node c center ≈ (130, 40) is still closer than a; place a better match.
    const nearCenter = node('center', 150, 80)
    const found = findNearestNodeIdToViewportCenter(
      [...nodes, nearCenter],
      { x: 0, y: 0, zoom: 1 },
      { width: 400, height: 200 },
    )
    expect(found).toBe('center')
  })

  it('returns null for empty graphs or zero-size canvas', () => {
    expect(
      findNearestNodeIdToViewportCenter([], { x: 0, y: 0, zoom: 1 }, { width: 400, height: 200 }),
    ).toBeNull()
    expect(
      findNearestNodeIdToViewportCenter(
        [node('a', 0, 0)],
        { x: 0, y: 0, zoom: 1 },
        { width: 0, height: 0 },
      ),
    ).toBeNull()
  })
})

describe('mindMapCanvasGeometry viewport intersection', () => {
  it('detects on-screen and off-screen cards under a fixed camera', () => {
    const canvas = { width: 400, height: 300 }
    const viewport = { x: 0, y: 0, zoom: 1 }
    const onScreen = node('on', 40, 40)
    const offScreen = node('off', 2000, 2000)

    expect(nodeIntersectsViewport(onScreen, viewport, canvas)).toBe(true)
    expect(nodeIntersectsViewport(offScreen, viewport, canvas)).toBe(false)
    expect(anyNodeIntersectsViewport([onScreen, offScreen], viewport, canvas)).toBe(true)
    expect(anyNodeIntersectsViewport([offScreen], viewport, canvas)).toBe(false)
  })

  it('accounts for zoom and pan when projecting card bounds', () => {
    const canvas = { width: 400, height: 300 }
    // Flow point (100, 100) lands at screen (0, 0) under this camera.
    const viewport = { x: -100, y: -100, zoom: 1 }
    const nearOrigin = node('near', 100, 100, 80, 40)
    expect(nodeIntersectsViewport(nearOrigin, viewport, canvas)).toBe(true)

    // Far card stays off-screen even with pan.
    const far = node('far', 5000, 5000)
    expect(nodeIntersectsViewport(far, viewport, canvas)).toBe(false)
  })
})
