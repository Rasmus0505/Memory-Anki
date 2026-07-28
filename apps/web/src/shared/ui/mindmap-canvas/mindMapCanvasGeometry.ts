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

/**
 * Whether a card's screen-space AABB intersects the canvas viewport.
 * `marginPx` expands (positive) or shrinks (negative) the hit box — use a small
 * negative margin so barely-clipped cards still count as visible.
 */
export function nodeIntersectsViewport(
  node: Node,
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  measuredSizes?: NodeSizeMap,
  marginPx = 0,
): boolean {
  if (canvasSize.width <= 0 || canvasSize.height <= 0 || viewport.zoom === 0) {
    return false
  }
  const size = getResolvedNodeSize(node, undefined, measuredSizes)
  const left = node.position.x * viewport.zoom + viewport.x
  const top = node.position.y * viewport.zoom + viewport.y
  const right = left + size.width * viewport.zoom
  const bottom = top + size.height * viewport.zoom
  return !(
    right < -marginPx
    || bottom < -marginPx
    || left > canvasSize.width + marginPx
    || top > canvasSize.height + marginPx
  )
}

/** True when at least one laid-out card intersects the current camera. */
export function anyNodeIntersectsViewport(
  nodes: readonly Node[],
  viewport: Viewport,
  canvasSize: { width: number; height: number },
  measuredSizes?: NodeSizeMap,
  marginPx = 0,
): boolean {
  for (const node of nodes) {
    if (nodeIntersectsViewport(node, viewport, canvasSize, measuredSizes, marginPx)) {
      return true
    }
  }
  return false
}
