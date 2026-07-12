import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { type Edge, type Node } from '@xyflow/react'
import type { GraphData } from './adapter'
import { getEventFeedbackPoint } from './mindMapCanvasGeometry'
import {
  applyMindMapLayout,
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
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  onNodeSelect: (nodeId: string | null) => void
  onEdit?: (nodeId: string, text: string) => void
  onReparent?: (sourceId: string, targetId: string) => void
  onReorderSibling?: (sourceId: string, targetId: string, position: 'before' | 'after') => void
  checkOverlap: (dragId: string, draggedNode?: Node, event?: unknown) => PreviewState | null | undefined
  flushPendingMeasuredNodeSizes: () => boolean
  closeEdgeMenu: () => void
  clearSelectedEdge: () => void
  resetPreviewFeedback: () => void
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
  onEdit,
  onReparent,
  onReorderSibling,
  checkOverlap,
  flushPendingMeasuredNodeSizes,
  closeEdgeMenu,
  clearSelectedEdge,
  resetPreviewFeedback,
}: UseMindMapDragInteractionsInput) {
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const [isDraggingNode, setIsDraggingNode] = useState(false)
  const previewStateRef = useRef<PreviewState | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const pendingDragRef = useRef<{ event: unknown; node: Node } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  void nodeSizeVersion

  useEffect(() => {
    previewStateRef.current = previewState
  }, [previewState])

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
    setPreviewState(null)
    isDraggingNodeRef.current = false
    setIsDraggingNode(false)
    draggingNodeIdRef.current = null
    pendingDragRef.current = null
    resetPreviewFeedback()
  }, [isDraggingNodeRef, resetPreviewFeedback])

  const handleNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      draggingNodeIdRef.current = node.id
      isDraggingNodeRef.current = true
      setIsDraggingNode(true)
      resetPreviewFeedback()
      setPreviewState(null)
      closeEdgeMenu()
      clearSelectedEdge()
      onNodeSelect(node.id)
      dispatchGlobalFeedback('drag_start', {
        point: getEventFeedbackPoint(_event),
        origin: 'pointer',
      })
    },
    [clearSelectedEdge, closeEdgeMenu, isDraggingNodeRef, onNodeSelect, readonly, resetPreviewFeedback],
  )

  const handleNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      pendingDragRef.current = { event: _event, node }
      if (dragFrameRef.current !== null) return

      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null
        const pending = pendingDragRef.current
        pendingDragRef.current = null
        if (pending) {
          const nextPreview = checkOverlap(pending.node.id, pending.node, pending.event)
          if (nextPreview !== undefined) {
            setPreviewState(nextPreview)
          }
        }
      })
    },
    [checkOverlap, readonly],
  )

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      const activePreview = previewStateRef.current
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
        dragFrameRef.current = null
      }
      pendingDragRef.current = null
      let appliedDrop = false
      if (activePreview && activePreview.sourceId === node.id) {
        dispatchGlobalFeedback('drag_drop', {
          point: getEventFeedbackPoint(_event),
          origin: 'pointer',
        })
        if (
          (activePreview.mode === 'before' ||
            activePreview.mode === 'after') &&
          onReorderSibling
        ) {
          onReorderSibling(node.id, activePreview.targetId, activePreview.mode)
          appliedDrop = true
        } else if (activePreview.mode === 'inside' && onReparent) {
          onReparent(node.id, activePreview.targetId)
          appliedDrop = true
        }
      }
      flushPendingMeasuredNodeSizes()
      if (!appliedDrop) {
        const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
        setNodes(nextLayout.nodes)
        setEdges(nextLayout.edges)
      }
      setPreviewState(null)
      isDraggingNodeRef.current = false
      setIsDraggingNode(false)
      draggingNodeIdRef.current = null
      resetPreviewFeedback()
    },
    [
      flushPendingMeasuredNodeSizes,
      graphData,
      isDraggingNodeRef,
      measuredNodeSizesRef,
      onReorderSibling,
      onReparent,
      readonly,
      resetPreviewFeedback,
      setEdges,
      setNodes,
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
    previewLayout: null,
    isDraggingNode,
    draggingNodeIdRef,
    resetDragState,
    handleFinishEdit,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
  }
}
