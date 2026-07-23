import { useCallback, useState, type MouseEvent } from 'react'
import { type EdgeMouseHandler, type Node } from '@xyflow/react'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapNodeClickViewportPolicy } from './MindMapCanvas'

export interface MindMapNodeMenuState {
  x: number
  y: number
  nodeId: string
  /** Multi-capable actions apply to this set (frozen when the menu opens). */
  targetNodeIds: string[]
}

export interface MindMapEdgeMenuState {
  x: number
  y: number
  edgeId: string
  sourceId: string
  targetId: string
}

interface UseMindMapMenusAndEdgesInput {
  onNodeSelect: (nodeId: string | null, options?: { additive?: boolean }) => void
  onNodeActivate?: (nodeId: string) => void
  onNodeContextAction?: (nodeId: string) => void
  onNodeHover?: (nodeId: string | null) => void
  onEdgeDelete?: (edgeId: string, sourceId: string, targetId: string) => void
  onEdgeInsert?: (edgeId: string, sourceId: string, targetId: string) => void
  mobileGuidedActive: boolean
  contextActionOnly: boolean
  nodeClickViewportPolicy: MindMapNodeClickViewportPolicy
  centerNodeInCanvas: (nodeId: string | null | undefined, duration?: number) => void
  readonly?: boolean
  /** Current multi-select set; used to preserve selection on right-click. */
  selectedNodeIds?: readonly string[]
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
  readonly = false,
  selectedNodeIds = [],
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

  /** Shared by desktop right-click and touch long-press (PWA edit menu / practice hide). */
  const openNodeContext = useCallback(
    (nodeId: string, point: { x: number; y: number }) => {
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      // Same rule as multi-drag: right-clicking an already-selected node keeps the multi-set.
      const alreadySelected = selectedNodeIds.includes(nodeId)
      const targetNodeIds =
        alreadySelected && selectedNodeIds.length > 1
          ? [...selectedNodeIds]
          : [nodeId]
      if (!alreadySelected) {
        onNodeSelect(nodeId)
      }
      if (contextActionOnly && onNodeContextAction) {
        setCtxMenu(null)
        onNodeContextAction(nodeId)
      } else {
        setCtxMenu({
          x: point.x,
          y: point.y,
          nodeId,
          targetNodeIds,
        })
      }
      dispatchGlobalFeedback('context_menu', {
        point,
        origin: 'node',
      })
    },
    [contextActionOnly, onNodeContextAction, onNodeSelect, selectedNodeIds],
  )

  const handleNodeContextMenu = useCallback(
    (event: MouseEvent, node: Node) => {
      event.preventDefault()
      openNodeContext(node.id, { x: event.clientX, y: event.clientY })
    },
    [openNodeContext],
  )

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null)
    onNodeHover?.(null)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
  }, [onNodeHover, onNodeSelect])

  const handleNodeClick = useCallback(
    (event: MouseEvent, node: Node) => {
      // Edit mode only: ignore 2nd+ click of a double-click so yellow-emphasis
      // re-select does not re-serialize HTML and swallow dblclick-to-edit.
      // Readonly flip-card / review intentionally multi-clicks the same node
      // (browser detail increments within the OS double-click window ~300–500ms).
      if (!readonly && event.detail > 1) return
      setSelectedEdgeId(null)
      setEdgeMenu(null)
      const additive = !readonly && (event.ctrlKey || event.metaKey)
      onNodeSelect(node.id, additive ? { additive: true } : undefined)
      if (!additive) {
        onNodeActivate?.(node.id)
      }
      if (mobileGuidedActive && nodeClickViewportPolicy === 'guided-center' && !additive) {
        centerNodeInCanvas(node.id)
      }
      dispatchGlobalFeedback('node_select', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'node',
      })
    },
    [
      centerNodeInCanvas,
      mobileGuidedActive,
      nodeClickViewportPolicy,
      onNodeActivate,
      onNodeSelect,
      readonly,
    ],
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
    openNodeContext,
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
