import type { Node } from '@xyflow/react'
import type { Viewport } from '@xyflow/react'
import { getResolvedNodeSize, type NodeSize, type NodeSizeMap } from './layout'

export function getEventFeedbackPoint(event: unknown) {
  if (!event || typeof event !== 'object') return undefined
  const candidate = event as { clientX?: unknown; clientY?: unknown }
  return typeof candidate.clientX === 'number' && typeof candidate.clientY === 'number'
    ? { x: candidate.clientX, y: candidate.clientY }
    : undefined
}

export function hasMeaningfulSizeChange(
  sizes: NodeSizeMap,
  nodeId: string,
  nextSize: NodeSize,
) {
  const previousSize = sizes.get(nodeId)
  return (
    !previousSize ||
    Math.abs(previousSize.width - nextSize.width) > 1 ||
    Math.abs(previousSize.height - nextSize.height) > 1
  )
}

/** Flow-space point currently shown at the canvas center under a React Flow viewport. */
export function getViewportCenterFlowPoint(
  viewport: Viewport,
  canvasSize: { width: number; height: number },
) {
  if (canvasSize.width <= 0 || canvasSize.height <= 0 || viewport.zoom === 0) {
    return null
  }
  return {
    x: (canvasSize.width / 2 - viewport.x) / viewport.zoom,
    y: (canvasSize.height / 2 - viewport.y) / viewport.zoom,
  }
}

/**
 * Node whose card center is nearest the current viewport center.
 * Used to re-anchor the camera after edit/review/practice scene switches.
 */
export function findNearestNodeIdToViewportCenter(
  nodes: readonly Node[],
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  measuredSizes?: NodeSizeMap,
): string | null {
  const center = getViewportCenterFlowPoint(viewport, canvasSize)
  if (!center || nodes.length === 0) return null

  let bestId: string | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    const size = getResolvedNodeSize(node, undefined, measuredSizes)
    const cx = node.position.x + size.width / 2
    const cy = node.position.y + size.height / 2
    const dist = Math.hypot(cx - center.x, cy - center.y)
    if (dist < bestDist) {
      bestDist = dist
      bestId = node.id
    }
  }
  return bestId
}
