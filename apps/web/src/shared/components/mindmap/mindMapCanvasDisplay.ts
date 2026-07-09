import type { Edge, Node } from '@xyflow/react'
import type { NodeSize, PreviewState } from './layout'

interface BuildDisplayNodesInput {
  nodes: Node[]
  previewNodes: Node[]
  previewState: PreviewState | null
  previousDisplayNodes?: Node[]
  sourceId: string | null
  isDraggingNode: boolean
  selectedNodeId: string | null
  onAddChild: (parentId: string) => void
  onDelete: (nodeId: string) => void
  onFinishEdit: (nodeId: string, text: string) => void
  onMeasure: (nodeId: string, size: NodeSize) => void
  readonly: boolean
}

export function buildDisplayNodes({
  nodes,
  previewNodes,
  previewState,
  previousDisplayNodes,
  sourceId,
  isDraggingNode,
  selectedNodeId,
  onAddChild,
  onDelete,
  onFinishEdit,
  onMeasure,
  readonly,
}: BuildDisplayNodesInput): Node[] {
  const previewNodesById = new Map(previewNodes.map((node) => [node.id, node]))
  const previousNodesById = new Map((previousDisplayNodes ?? []).map((node) => [node.id, node]))

  return nodes.map((node) => {
    const preview = previewState && previewState.targetId === node.id ? previewState : null
    const previewNode = previewNodesById.get(node.id)
    const isSource = isDraggingNode && node.id === sourceId
    const shifted = Boolean(
      previewNode &&
        (Math.abs(previewNode.position.x - node.position.x) > 8 ||
          Math.abs(previewNode.position.y - node.position.y) > 8),
    )

    const position = isSource || !previewNode ? node.position : previewNode.position
    const zIndex = isSource ? 100 : preview ? 50 : 1
    const nextData = {
      ...(node.data as Record<string, unknown>),
      selected: node.id === selectedNodeId,
      dropHighlight: Boolean(preview),
      dropMode: preview?.mode ?? null,
      previewShifted: shifted && !isSource,
      previewAdopt: preview?.mode === 'inside',
      previewGhost: isSource,
      onAddChild,
      onDelete,
      onFinishEdit,
      onMeasure,
      readonly,
    }
    const previous = previousNodesById.get(node.id)

    if (
      previous &&
      previous.type === node.type &&
      previous.sourcePosition === node.sourcePosition &&
      previous.targetPosition === node.targetPosition &&
      previous.draggable === node.draggable &&
      previous.position.x === position.x &&
      previous.position.y === position.y &&
      previous.zIndex === zIndex &&
      shallowEqualNodeData(previous.data as Record<string, unknown>, nextData)
    ) {
      return previous
    }

    return {
      ...node,
      position,
      zIndex,
      data: nextData,
    }
  })
}

export function buildDisplayEdges(
  edges: Edge[],
  selectedEdgeId: string | null,
  previousDisplayEdges: Edge[] = [],
): Edge[] {
  const previousEdgesById = new Map(previousDisplayEdges.map((edge) => [edge.id, edge]))

  return edges.map((edge) => buildDisplayEdge(edge, selectedEdgeId, previousEdgesById.get(edge.id)))
}

function buildDisplayEdge(
  edge: Edge,
  selectedEdgeId: string | null,
  previous?: Edge,
): Edge {
  const className =
    edge.id === selectedEdgeId
      ? `${edge.className ?? ''} memory-anki-reactflow-edge-selected`.trim()
      : edge.className
  const style = {
    ...(edge.style ?? {}),
    stroke:
      edge.id === selectedEdgeId
        ? '#4f6d67'
        : edge.style?.stroke ?? '#89a89e',
    strokeWidth:
      edge.id === selectedEdgeId
        ? 2.3
        : edge.style?.strokeWidth ?? 1.5,
    opacity:
      edge.id === selectedEdgeId
        ? 1
        : edge.style?.opacity ?? 0.94,
  }

  if (
    previous &&
    previous.source === edge.source &&
    previous.target === edge.target &&
    previous.type === edge.type &&
    previous.label === edge.label &&
    previous.className === className &&
    shallowEqualNodeData((previous.style ?? {}) as Record<string, unknown>, style as Record<string, unknown>)
  ) {
    return previous
  }

  return {
    ...edge,
    className,
    style,
  }
}

function shallowEqualNodeData(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const previousKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (previousKeys.length !== nextKeys.length) return false
  for (const key of previousKeys) {
    if (previous[key] !== next[key]) return false
  }
  return true
}
