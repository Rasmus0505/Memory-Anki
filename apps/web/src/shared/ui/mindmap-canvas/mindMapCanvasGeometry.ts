import type { NodeSize, NodeSizeMap } from './layout'

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
