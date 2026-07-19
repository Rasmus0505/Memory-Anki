import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  findNearestNodeIdToViewportCenter,
  getViewportCenterFlowPoint,
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
