import type { Edge, Node } from '@xyflow/react'
import type { NodeSize, PreviewState } from './layout'
import type { SelectionToolbarAction, SelectionToolbarPreferPosition } from './selectionToolbar'

interface BuildDisplayNodesInput {
  nodes: Node[]
  previewNodes: Node[]
  previewState: PreviewState | null
  previousDisplayNodes?: Node[]
  sourceId: string | null
  sourceIds?: readonly string[]
  isDraggingNode: boolean
  /** Live pointer-drag positions; wins over controlled `nodes` to avoid mid-drag snap-back. */
  liveDragPositions?: ReadonlyMap<string, { x: number; y: number }> | null
  selectedNodeId: string | null
  selectedNodeIds?: readonly string[]
  editingNodeId: string | null
  editingDraft: string | null
  selectEditingText?: boolean
  onStartEdit: (nodeId: string) => void
  onCancelEdit: (nodeId: string) => void
  onEditTextChange?: (nodeId: string, text: string) => void
  onAddChild: (parentId: string) => void
  onAddSibling: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onFinishEdit: (nodeId: string, text: string) => void
  onMeasure: (nodeId: string, size: NodeSize) => void
  onExtractSelection?: (payload: {
    sourceId: string
    liveText: string
    start: number
    end: number
    placement: { mode: 'inside' | 'before' | 'after'; targetUid: string }
  }) => void
  onExtractDropPreview?: (
    next: { targetId: string; mode: 'before' | 'inside' | 'after' } | null,
  ) => void
  readonly: boolean
  touchLongPressEnabled?: boolean
  onTouchLongPress?: (nodeId: string, point: { x: number; y: number }) => void
  buildSelectionToolbarActions?: (nodeId: string) => SelectionToolbarAction[]
  selectionToolbarPreferPosition?: SelectionToolbarPreferPosition
  extractDropTargetId?: string | null
  extractDropMode?: 'before' | 'inside' | 'after' | null
}

export function buildDisplayNodes({
  nodes,
  previewNodes,
  previewState,
  previousDisplayNodes,
  sourceId,
  sourceIds,
  isDraggingNode,
  liveDragPositions = null,
  selectedNodeId,
  selectedNodeIds,
  editingNodeId,
  editingDraft,
  selectEditingText = false,
  onStartEdit,
  onCancelEdit,
  onEditTextChange,
  onAddChild,
  onAddSibling,
  onDelete,
  onFinishEdit,
  onMeasure,
  onExtractSelection,
  onExtractDropPreview,
  readonly,
  touchLongPressEnabled = false,
  onTouchLongPress,
  buildSelectionToolbarActions,
  selectionToolbarPreferPosition = 'auto',
  extractDropTargetId = null,
  extractDropMode = null,
}: BuildDisplayNodesInput): Node[] {
  const previewNodesById = new Map(previewNodes.map((node) => [node.id, node]))
  const previousNodesById = new Map((previousDisplayNodes ?? []).map((node) => [node.id, node]))
  const dragSourceIds = new Set(
    sourceIds?.length
      ? sourceIds
      : previewState?.sourceIds?.length
        ? previewState.sourceIds
        : sourceId
          ? [sourceId]
          : [],
  )
  const selectedIds = new Set(
    selectedNodeIds?.length
      ? selectedNodeIds
      : selectedNodeId
        ? [selectedNodeId]
        : [],
  )

  return nodes.map((node) => {
    const preview = previewState && previewState.targetId === node.id ? previewState : null
    const extractPreview =
      extractDropTargetId === node.id && extractDropMode
        ? { mode: extractDropMode }
        : null
    const activeDrop = preview ?? extractPreview
    const previewNode = previewNodesById.get(node.id)
    const isSource = isDraggingNode && dragSourceIds.has(node.id)
    const shifted = Boolean(
      previewNode &&
        (Math.abs(previewNode.position.x - node.position.x) > 8 ||
          Math.abs(previewNode.position.y - node.position.y) > 8),
    )

    // Live drag positions must win: setPreviewState re-renders can race ahead of
    // useNodesState and would otherwise feed React Flow a stale origin (snap-back).
    const livePosition = liveDragPositions?.get(node.id)
    const position =
      livePosition ?? (isSource || !previewNode ? node.position : previewNode.position)
    const zIndex = isSource ? 100 : activeDrop ? 50 : 1
    const isSelected = selectedIds.has(node.id)
    const isEditing = node.id === editingNodeId
    // Idle cards are structure-draggable; only edit mode (and readonly) blocks drag.
    const canDrag = !readonly && !isEditing
    // Selection toolbar only on primary (last selected) node.
    const selectionToolbarActions =
      node.id === selectedNodeId ? buildSelectionToolbarActions?.(node.id) ?? [] : []
    const nextData = {
      ...(node.data as Record<string, unknown>),
      selected: isSelected,
      editing: isEditing,
      editText: isEditing ? editingDraft : null,
      selectEditText: isEditing && selectEditingText,
      dropHighlight: Boolean(activeDrop),
      dropMode: activeDrop?.mode ?? null,
      previewShifted: shifted && !isSource,
      previewAdopt: activeDrop?.mode === 'inside',
      previewGhost: isSource,
      onAddChild,
      onAddSibling,
      onDelete,
      onStartEdit,
      onCancelEdit,
      onEditTextChange,
      onFinishEdit,
      onMeasure,
      onExtractSelection,
      onExtractDropPreview,
      readonly,
      onTouchLongPress: touchLongPressEnabled ? onTouchLongPress : undefined,
      selectionToolbarActions: selectionToolbarActions.length > 0 ? selectionToolbarActions : undefined,
      selectionToolbarPreferPosition:
        selectionToolbarActions.length > 0 ? selectionToolbarPreferPosition : undefined,
    }
    const previous = previousNodesById.get(node.id)
    const dragHandle = canDrag ? '.mindmap-node-drag-surface' : undefined

    if (
      previous &&
      previous.type === node.type &&
      previous.sourcePosition === node.sourcePosition &&
      previous.targetPosition === node.targetPosition &&
      previous.draggable === canDrag &&
      previous.dragHandle === dragHandle &&
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
      draggable: canDrag,
      dragHandle,
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
  const baseStrokeWidth = Number(edge.style?.strokeWidth ?? 1.5)
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
        ? Math.max(baseStrokeWidth + 1, 3)
        : baseStrokeWidth,
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
