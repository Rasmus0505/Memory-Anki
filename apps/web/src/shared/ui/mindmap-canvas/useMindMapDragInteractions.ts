import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import type { GraphData } from './adapter'
import { getEventFeedbackPoint } from './mindMapCanvasGeometry'
import {
  applyMindMapLayout,
  type DropMode,
  type NodeSize,
  type PreviewState,
} from './layout'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'

interface UseMindMapDragInteractionsInput {
  readonly: boolean
  graphData: GraphData
  nodeSizeVersion: number
  measuredNodeSizesRef: RefObject<Map<string, NodeSize>>
  isDraggingNodeRef: RefObject<boolean>
  setNodes: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void
  setEdges: (edges: Edge[]) => void
  onNodeSelect: (nodeId: string | null, options?: { additive?: boolean }) => void
  selectedNodeIds?: readonly string[]
  onEdit?: (nodeId: string, text: string) => void
  onRelocate?: (sourceIds: string[], targetId: string, mode: DropMode) => void
  onReparent?: (sourceId: string, targetId: string) => void
  onReorderSibling?: (sourceId: string, targetId: string, position: 'before' | 'after') => void
  checkOverlap: (
    dragId: string,
    draggedNode?: Node,
    event?: unknown,
    dragSourceIds?: readonly string[],
  ) => PreviewState | null | undefined
  flushPendingMeasuredNodeSizes: () => boolean
  closeEdgeMenu: () => void
  clearSelectedEdge: () => void
  resetPreviewFeedback: () => void
}

function collectBlockedDescendants(
  graphData: GraphData,
  sourceIds: readonly string[],
): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const node of graphData.nodes) {
    if (!node.parentId) continue
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node.id)
    childrenByParent.set(node.parentId, list)
  }
  const blocked = new Set<string>(sourceIds)
  for (const sourceId of sourceIds) {
    const stack = [...(childrenByParent.get(sourceId) ?? [])]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (blocked.has(current)) continue
      blocked.add(current)
      stack.push(...(childrenByParent.get(current) ?? []))
    }
  }
  return blocked
}

/** Prefer top-level selected nodes (exclude descendants of other selected nodes). */
export function resolveDragSourceIds(
  graphData: GraphData,
  primaryId: string,
  selectedNodeIds: readonly string[] | undefined,
): string[] {
  const selected = selectedNodeIds?.includes(primaryId)
    ? selectedNodeIds.filter(Boolean)
    : [primaryId]
  const selectedSet = new Set(selected)
  const parentById = new Map(graphData.nodes.map((node) => [node.id, node.parentId ?? null]))
  const isUnderSelectedAncestor = (nodeId: string) => {
    let current = parentById.get(nodeId) ?? null
    while (current) {
      if (selectedSet.has(current)) return true
      current = parentById.get(current) ?? null
    }
    return false
  }
  const topLevel = selected.filter((id) => !isUnderSelectedAncestor(id))
  return topLevel.length > 0 ? topLevel : [primaryId]
}

export function useMindMapDragInteractions({
  readonly,
  graphData,
  nodeSizeVersion,
  measuredNodeSizesRef,
  isDraggingNodeRef,
  setNodes,
  setEdges,
  onNodeSelect,
  selectedNodeIds,
  onEdit,
  onRelocate,
  onReparent,
  onReorderSibling,
  checkOverlap,
  flushPendingMeasuredNodeSizes,
  closeEdgeMenu,
  clearSelectedEdge,
  resetPreviewFeedback,
}: UseMindMapDragInteractionsInput) {
  const { getNodes } = useReactFlow()
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const [isDraggingNode, setIsDraggingNode] = useState(false)
  /** Bumps when live drag positions change so displayNodes re-reads the ref. */
  const [liveDragVersion, setLiveDragVersion] = useState(0)
  const previewStateRef = useRef<PreviewState | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const dragSourceIdsRef = useRef<string[]>([])
  const selectedNodeIdsRef = useRef<readonly string[] | undefined>(selectedNodeIds)
  const originPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const liveDragPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const primaryOriginRef = useRef<{ x: number; y: number } | null>(null)
  const pendingDragRef = useRef<{ event: unknown; node: Node } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  void nodeSizeVersion

  selectedNodeIdsRef.current = selectedNodeIds

  const commitPreviewState = useCallback((next: PreviewState | null) => {
    // Keep ref in sync immediately so drag-stop cannot miss a just-computed target.
    previewStateRef.current = next
    setPreviewState(next)
  }, [])

  useEffect(() => {
    isDraggingNodeRef.current = isDraggingNode
  }, [isDraggingNode, isDraggingNodeRef])

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
      }
    }
  }, [])

  const resetDragState = useCallback(() => {
    commitPreviewState(null)
    isDraggingNodeRef.current = false
    setIsDraggingNode(false)
    draggingNodeIdRef.current = null
    dragSourceIdsRef.current = []
    originPositionsRef.current = new Map()
    liveDragPositionsRef.current = new Map()
    primaryOriginRef.current = null
    pendingDragRef.current = null
    resetPreviewFeedback()
  }, [commitPreviewState, isDraggingNodeRef, resetPreviewFeedback])

  const applyDrop = useCallback(
    (sourceIds: string[], targetId: string, mode: DropMode) => {
      if (onRelocate) {
        onRelocate(sourceIds, targetId, mode)
        return true
      }
      if ((mode === 'before' || mode === 'after') && onReorderSibling) {
        for (const sourceId of sourceIds) {
          onReorderSibling(sourceId, targetId, mode)
        }
        return true
      }
      if (mode === 'inside' && onReparent) {
        for (const sourceId of sourceIds) {
          onReparent(sourceId, targetId)
        }
        return true
      }
      return false
    },
    [onRelocate, onReorderSibling, onReparent],
  )

  const writeLiveDragPositions = useCallback((primaryNode: Node) => {
    const primaryOrigin = primaryOriginRef.current
    const sourceIds = dragSourceIdsRef.current
    const next = new Map<string, { x: number; y: number }>()
    next.set(primaryNode.id, {
      x: primaryNode.position.x,
      y: primaryNode.position.y,
    })

    if (primaryOrigin && sourceIds.length > 1) {
      const delta = {
        x: primaryNode.position.x - primaryOrigin.x,
        y: primaryNode.position.y - primaryOrigin.y,
      }
      for (const sourceId of sourceIds) {
        if (sourceId === primaryNode.id) continue
        const origin = originPositionsRef.current.get(sourceId)
        if (!origin) continue
        next.set(sourceId, {
          x: origin.x + delta.x,
          y: origin.y + delta.y,
        })
      }
    }

    liveDragPositionsRef.current = next
  }, [])

  /** Keep controlled `nodes` positions aligned with the pointer so preview re-renders cannot snap back. */
  const syncDragPositionsIntoNodes = useCallback(
    (primaryNode: Node) => {
      const live = liveDragPositionsRef.current
      if (live.size === 0) {
        setNodes((current) =>
          current.map((item) =>
            item.id === primaryNode.id ? { ...item, position: primaryNode.position } : item,
          ),
        )
        return
      }
      setNodes((current) =>
        current.map((item) => {
          const position = live.get(item.id)
          if (!position) return item
          if (item.position.x === position.x && item.position.y === position.y) return item
          return { ...item, position }
        }),
      )
    },
    [setNodes],
  )

  const handleNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      const latestSelected = selectedNodeIdsRef.current
      const sourceIds = resolveDragSourceIds(graphData, node.id, latestSelected)
      draggingNodeIdRef.current = node.id
      dragSourceIdsRef.current = sourceIds
      isDraggingNodeRef.current = true
      setIsDraggingNode(true)
      resetPreviewFeedback()
      commitPreviewState(null)
      closeEdgeMenu()
      clearSelectedEdge()

      const currentNodes = getNodes()
      const origins = new Map<string, { x: number; y: number }>()
      for (const sourceId of sourceIds) {
        const sourceNode = currentNodes.find((item) => item.id === sourceId)
        if (sourceNode) {
          origins.set(sourceId, {
            x: sourceNode.position.x,
            y: sourceNode.position.y,
          })
        }
      }
      // Primary may already be slightly moved; prefer its start position from snapshot.
      if (!origins.has(node.id)) {
        origins.set(node.id, { x: node.position.x, y: node.position.y })
      }
      originPositionsRef.current = origins
      liveDragPositionsRef.current = new Map(origins)
      primaryOriginRef.current = origins.get(node.id) ?? {
        x: node.position.x,
        y: node.position.y,
      }
      setLiveDragVersion((version) => version + 1)

      // Select for toolbar/multi-select, but drag no longer requires a prior click.
      if (!latestSelected?.includes(node.id)) {
        onNodeSelect(node.id)
      }
      // One sound for the whole structure-drag gesture (no hover chatter).
      dispatchGlobalFeedback('drag_start', {
        point: getEventFeedbackPoint(_event),
        origin: 'pointer',
      })
    },
    [
      clearSelectedEdge,
      closeEdgeMenu,
      commitPreviewState,
      getNodes,
      graphData,
      isDraggingNodeRef,
      onNodeSelect,
      readonly,
      resetPreviewFeedback,
    ],
  )

  const handleNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      writeLiveDragPositions(node)
      syncDragPositionsIntoNodes(node)
      pendingDragRef.current = { event: _event, node }
      if (dragFrameRef.current !== null) return

      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null
        const pending = pendingDragRef.current
        pendingDragRef.current = null
        if (pending) {
          writeLiveDragPositions(pending.node)
          syncDragPositionsIntoNodes(pending.node)
          const sourceIds =
            dragSourceIdsRef.current.length > 0
              ? dragSourceIdsRef.current
              : [pending.node.id]
          const nextPreview = checkOverlap(
            pending.node.id,
            pending.node,
            pending.event,
            sourceIds,
          )
          if (nextPreview !== undefined) {
            // Preview chrome re-render must still show the latest drag coordinates.
            setLiveDragVersion((version) => version + 1)
            commitPreviewState(nextPreview)
          }
        }
      })
    },
    [checkOverlap, commitPreviewState, readonly, syncDragPositionsIntoNodes, writeLiveDragPositions],
  )

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      writeLiveDragPositions(node)

      // Flush the last pointer sample so a quick drop still sees the hovered target.
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      const pending = pendingDragRef.current
      pendingDragRef.current = null
      if (pending) {
        const sourceIds =
          dragSourceIdsRef.current.length > 0
            ? dragSourceIdsRef.current
            : [pending.node.id]
        const flushed = checkOverlap(
          pending.node.id,
          pending.node,
          pending.event,
          sourceIds,
        )
        if (flushed !== undefined) {
          previewStateRef.current = flushed
        }
      } else {
        const sourceIds =
          dragSourceIdsRef.current.length > 0 ? dragSourceIdsRef.current : [node.id]
        const flushed = checkOverlap(node.id, node, _event, sourceIds)
        if (flushed !== undefined) {
          previewStateRef.current = flushed
        }
      }

      const activePreview = previewStateRef.current
      let appliedDrop = false
      const sourceIds =
        dragSourceIdsRef.current.length > 0 ? dragSourceIdsRef.current : [node.id]
      if (activePreview && activePreview.sourceId === node.id) {
        const blocked = collectBlockedDescendants(graphData, sourceIds)
        if (!blocked.has(activePreview.targetId)) {
          // Audio: only drag_start for the gesture (no second drop sound).
          appliedDrop = applyDrop(sourceIds, activePreview.targetId, activePreview.mode)
        }
      }
      flushPendingMeasuredNodeSizes()
      if (!appliedDrop) {
        const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
        setNodes(nextLayout.nodes)
        setEdges(nextLayout.edges)
      }
      // Clear drag flags before live positions so display falls back to laid-out nodes.
      isDraggingNodeRef.current = false
      setIsDraggingNode(false)
      draggingNodeIdRef.current = null
      dragSourceIdsRef.current = []
      originPositionsRef.current = new Map()
      liveDragPositionsRef.current = new Map()
      primaryOriginRef.current = null
      commitPreviewState(null)
      resetPreviewFeedback()
    },
    [
      applyDrop,
      checkOverlap,
      commitPreviewState,
      flushPendingMeasuredNodeSizes,
      graphData,
      isDraggingNodeRef,
      measuredNodeSizesRef,
      readonly,
      resetPreviewFeedback,
      setEdges,
      setNodes,
      writeLiveDragPositions,
    ],
  )

  const handleFinishEdit = useCallback(
    (nodeId: string, text: string) => {
      if (readonly) return
      onEdit?.(nodeId, text)
    },
    [onEdit, readonly],
  )

  return {
    previewState,
    isDraggingNode,
    liveDragVersion,
    liveDragPositionsRef,
    draggingNodeIdRef,
    dragSourceIdsRef,
    resetDragState,
    handleFinishEdit,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
  }
}
