import { useCallback, useState, type MouseEvent } from 'react'
import { type EdgeMouseHandler, type Node } from '@xyflow/react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNodeClickViewportPolicy } from './MindMapCanvas'

export interface MindMapNodeMenuState {
  x: number
  y: number
  nodeId: string
}

export interface MindMapEdgeMenuState {
  x: number
  y: number
  edgeId: string
  sourceId: string
  targetId: string
}

interface UseMindMapMenusAndEdgesInput {
  onNodeSelect: (nodeId: string | null) => void
  onNodeActivate?: (nodeId: string) => void
  onNodeContextAction?: (nodeId: string) => void
  onNodeHover?: (nodeId: string | null) => void
  onEdgeDelete?: (edgeId: string, sourceId: string, targetId: string) => void
  onEdgeInsert?: (edgeId: string, sourceId: string, targetId: string) => void
  mobileGuidedActive: boolean
  contextActionOnly: boolean
  nodeClickViewportPolicy: MindMapNodeClickViewportPolicy
  centerNodeInCanvas: (nodeId: string | null | undefined, duration?: number) => void
}

export function useMindMapMenusAndEdges({
  onNodeSelect,
  onNodeActivate,
  onNodeContextAction,
  onNodeHover,
  onEdgeDelete,
  onEdgeInsert,
  mobileGuidedActive,
  contextActionOnly,
  nodeClickViewportPolicy,
  centerNodeInCanvas,
}: UseMindMapMenusAndEdgesInput) {
  const [ctxMenu, setCtxMenu] = useState<MindMapNodeMenuState | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<MindMapEdgeMenuState | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  const closeNodeMenu = useCallback(() => {
    setCtxMenu(null)
  }, [])

  const closeEdgeMenu = useCallback(() => {
    setEdgeMenu(null)
  }, [])

  const clearEdgeSelection = useCallback(() => {
    setSelectedEdgeId(null)
    setEdgeMenu(null)
  }, [])

  const handleNodeContextMenu = useCallback(
    (event: MouseEvent, node: Node) => {
      event.preventDefault()
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(node.id)
      if (contextActionOnly && onNodeContextAction) {
        setCtxMenu(null)
        onNodeContextAction(node.id)
      } else {
        setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
      }
      dispatchGlobalFeedback('context_menu', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'node',
      })
    },
    [contextActionOnly, onNodeContextAction, onNodeSelect],
  )

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null)
    onNodeHover?.(null)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
  }, [onNodeHover, onNodeSelect])

  const handleNodeClick = useCallback(
    (event: MouseEvent, node: Node) => {
      setSelectedEdgeId(null)
      setEdgeMenu(null)
      onNodeSelect(node.id)
      onNodeActivate?.(node.id)
      if (mobileGuidedActive && nodeClickViewportPolicy === 'guided-center') {
        centerNodeInCanvas(node.id)
      }
      dispatchGlobalFeedback('node_select', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'node',
      })
    },
    [centerNodeInCanvas, mobileGuidedActive, nodeClickViewportPolicy, onNodeActivate, onNodeSelect],
  )

  const handleNodeMouseEnter = useCallback(
    (_event: MouseEvent, node: Node) => {
      onNodeHover?.(node.id)
    },
    [onNodeHover],
  )

  const handleNodeMouseLeave = useCallback(
    () => {
      onNodeHover?.(null)
    },
    [onNodeHover],
  )

  const handleEdgeDelete = useCallback(
    (edgeId: string, sourceId: string, targetId: string) => {
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      dispatchGlobalFeedback('node_delete', {
        origin: 'edge',
        label: 'EDGE',
      })
      onEdgeDelete?.(edgeId, sourceId, targetId)
    },
    [onEdgeDelete],
  )

  const handleEdgeInsert = useCallback(
    (edgeId: string, sourceId: string, targetId: string) => {
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      dispatchGlobalFeedback('node_create', {
        origin: 'edge',
        label: 'CARD',
      })
      onEdgeInsert?.(edgeId, sourceId, targetId)
    },
    [onEdgeInsert],
  )

  const handleEdgeClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault()
      event.stopPropagation()
      setCtxMenu(null)
      setSelectedEdgeId(edge.id)
      setEdgeMenu({
        x: event.clientX,
        y: event.clientY,
        edgeId: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
      })
      onNodeSelect(null)
      dispatchGlobalFeedback('node_select', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'edge',
        label: 'EDGE',
      })
    },
    [onNodeSelect],
  )

  const handleEdgeDoubleClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault()
      event.stopPropagation()
      dispatchGlobalFeedback('node_delete', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'edge',
        label: 'EDGE',
      })
      handleEdgeDelete(edge.id, edge.source, edge.target)
    },
    [handleEdgeDelete],
  )

  return {
    ctxMenu,
    edgeMenu,
    selectedEdgeId,
    closeNodeMenu,
    closeEdgeMenu,
    clearEdgeSelection,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    handleEdgeClick,
    handleEdgeDoubleClick,
    handlePaneClick,
    handleEdgeDelete,
    handleEdgeInsert,
  }
}
