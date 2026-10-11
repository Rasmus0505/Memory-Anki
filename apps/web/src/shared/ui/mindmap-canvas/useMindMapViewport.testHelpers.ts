import type { Node, Viewport } from '@xyflow/react'
import { vi } from 'vitest'
import type { MindMapNode } from './adapter'
import type { useMindMapViewport } from './useMindMapViewport'

export function buildProps(overrides: Partial<Parameters<typeof useMindMapViewport>[0]> = {}) {
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

export function canvasHost() {
  const host = document.createElement('div')
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  })
  return { current: host }
}

export function flowNode(id: string, x: number, y: number) {
  // Short label keeps the typographic size estimate below the measured 100×40 card.
  return { id, position: { x, y }, data: { label: id }, type: 'mindmap', width: 100, height: 40 }
}

export function graphNode(id: string, parentId: string | null): MindMapNode {
  return {
    id,
    type: 'chapter',
    label: id,
    originalId: 1,
    parentId,
    metadata: {},
  }
}
