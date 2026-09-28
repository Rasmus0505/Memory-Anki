import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  anyNodeIntersectsViewport,
  findNearestNodeIdToViewportCenter,
  getViewportCenterFlowPoint,
  minimalShiftToRevealRect,
  nodeIntersectsViewport,
  pickMostOutOfViewNodeId,
  resolveSceneRecenterAnchorId,
  SCENE_FIT_SENTINEL,
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

describe('mindMapCanvasGeometry reveal into view', () => {
  const canvas = { width: 400, height: 300 }
  const viewport = { x: 0, y: 0, zoom: 1 }
  const sizes = new Map([
    ['visible', { width: 100, height: 40 }],
    ['near', { width: 100, height: 40 }],
    ['far', { width: 100, height: 40 }],
  ])

  it('leaves a fully visible card unmoved', () => {
    expect(minimalShiftToRevealRect(
      { left: 40, top: 40, right: 140, bottom: 80 },
      canvas,
      32,
    )).toEqual({ dx: 0, dy: 0 })
    expect(pickMostOutOfViewNodeId(
      [node('visible', 40, 40)],
      ['visible'],
      viewport,
      canvas,
      sizes,
      32,
    )).toBeNull()
  })

  it('pans the minimum distance to clear a clipped edge plus padding', () => {
    const shift = minimalShiftToRevealRect(
      { left: 360, top: 40, right: 460, bottom: 80 },
      canvas,
      32,
    )
    expect(shift.dx).toBeCloseTo(400 - 32 - 460)
    expect(shift.dy).toBe(0)
  })

  it('picks the card that needs the larger pan when several are clipped', () => {
    const picked = pickMostOutOfViewNodeId(
      [node('near', 350, 40), node('far', 900, 40)],
      ['near', 'far'],
      viewport,
      canvas,
      sizes,
      32,
    )
    expect(picked?.nodeId).toBe('far')
    expect(picked?.dx).toBeCloseTo(400 - 32 - 1000)
    expect(picked?.dy).toBe(0)
  })

  it('does not pan an oversized card that already covers the viewport', () => {
    expect(minimalShiftToRevealRect(
      { left: -20, top: -20, right: 500, bottom: 400 },
      canvas,
      32,
    )).toEqual({ dx: 0, dy: 0 })
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

describe('mindMapCanvasGeometry scene recenter', () => {
  it('keeps the requested card when it is still present', () => {
    expect(resolveSceneRecenterAnchorId({
      requestedId: 'child',
      presentIds: ['root', 'child'],
      rootId: 'root',
    })).toBe('child')
  })

  it('walks to the nearest still-present ancestor before the host fallback', () => {
    expect(resolveSceneRecenterAnchorId({
      requestedId: 'leaf',
      presentIds: ['root', 'unit'],
      parentById: new Map([
        ['leaf', 'unit'],
        ['unit', 'root'],
        ['root', null],
      ]),
      fallbackId: 'root',
      rootId: 'root',
    })).toBe('unit')
  })

  it('uses the host fallback when the requested card and its ancestors are gone', () => {
    expect(resolveSceneRecenterAnchorId({
      requestedId: 'other-unit',
      presentIds: ['root', 'unit'],
      parentById: new Map([
        ['other-unit', 'gone-parent'],
        ['gone-parent', null],
      ]),
      fallbackId: 'unit',
      rootId: 'root',
    })).toBe('unit')
  })

  it('fits only when the next graph is empty', () => {
    expect(resolveSceneRecenterAnchorId({
      requestedId: 'child',
      presentIds: [],
      fallbackId: 'unit',
      rootId: 'root',
    })).toBe(SCENE_FIT_SENTINEL)
  })
})
