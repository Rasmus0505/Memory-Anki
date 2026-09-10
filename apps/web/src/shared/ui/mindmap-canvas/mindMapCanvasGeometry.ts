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

export const SCENE_FIT_SENTINEL = '__scene_fit__'

/**
 * Pick the card to re-center after an edit/review scene switch.
 * Prefer the previous center card, then a still-present ancestor, then a host
 * fallback (unit anchor), then the graph root. Fit only when the new graph is empty.
 */
export function resolveSceneRecenterAnchorId(options: {
  requestedId?: string | null
  presentIds: Iterable<string>
  parentById?: ReadonlyMap<string, string | null>
  fallbackId?: string | null
  rootId?: string | null
}): string | typeof SCENE_FIT_SENTINEL {
  const present = options.presentIds instanceof Set
    ? options.presentIds
    : new Set(options.presentIds)
  if (present.size === 0) return SCENE_FIT_SENTINEL

  const requested = String(options.requestedId || '').trim()
  if (requested && present.has(requested)) return requested
  if (requested && options.parentById) {
    const seen = new Set<string>()
    let current = options.parentById.get(requested) ?? null
    while (current && !seen.has(current)) {
      if (present.has(current)) return current
      seen.add(current)
      current = options.parentById.get(current) ?? null
    }
  }

  const fallback = String(options.fallbackId || '').trim()
  if (fallback && present.has(fallback)) return fallback
  const root = String(options.rootId || '').trim()
  if (root && present.has(root)) return root
  return SCENE_FIT_SENTINEL
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
