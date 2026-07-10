import {
  useCallback,
  useEffect,
  useMemo,
  type RefObject,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import {
  type OnEdgesChange,
  type OnNodesChange,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeMouseHandler,
  type Node,
} from '@xyflow/react'
import type { ContextMenuAction } from './NodeContextMenu'
import { applyMindMapLayout, type NodeSize } from './layout'
import { buildEdgeActions, buildNodeActions } from './mindMapCanvasActions'
import { buildDisplayEdges, buildDisplayNodes } from './mindMapCanvasDisplay'
import { useMindMapDragInteractions } from './useMindMapDragInteractions'
import { useMindMapMenusAndEdges } from './useMindMapMenusAndEdges'
import { useMindMapViewport } from './useMindMapViewport'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { MindMapCanvasProps } from './MindMapCanvas'

type UseMindMapCanvasStateProps = MindMapCanvasProps & {
  toolbarVisible?: boolean
  onHostRefresh?: () => void
}

export interface UseMindMapCanvasStateResult {
  frameRef: RefObject<HTMLDivElement | null>
  ctxMenu: { x: number; y: number; nodeId: string } | null
  edgeMenu: { x: number; y: number; edgeId: string; sourceId: string; targetId: string } | null
  canvasSize: { width: number; height: number }
  isCanvasReady: boolean
  displayNodes: Node[]
  displayEdges: Edge[]
  isDraggingNode: boolean
  mobileGuidedActive: boolean
  nodeActions: ContextMenuAction[]
  edgeActions: ContextMenuAction[]
  canShowHistoryControls: boolean
  canUndo: boolean
  canRedo: boolean
  runFitView: (duration?: number) => void
  zoomInCanvas: () => void
  zoomOutCanvas: () => void
  resetLayout: () => void
  refreshCanvas: () => void
  closeNodeMenu: () => void
  closeEdgeMenu: () => void
  onNodesChange: OnNodesChange<Node>
  onEdgesChange: OnEdgesChange<Edge>
  handleNodeClick: (event: MouseEvent, node: Node) => void
  handleNodeDoubleClick: (event: MouseEvent, node: Node) => void
  handleNodeContextMenu: (event: MouseEvent, node: Node) => void
  handleNodeMouseEnter: (event: MouseEvent, node: Node) => void
  handleNodeMouseLeave: (event: MouseEvent, node: Node) => void
  handleNodeDragStart: (event: unknown, node: Node) => void
  handleNodeDrag: (event: unknown, node: Node) => void
  handleNodeDragStop: (event: unknown, node: Node) => void
  handleEdgeClick: EdgeMouseHandler
  handleEdgeDoubleClick: EdgeMouseHandler
  handlePaneClick: () => void
  handleMoveStart: ReturnType<typeof useMindMapViewport>['handleMoveStart']
  handleMove: ReturnType<typeof useMindMapViewport>['handleMove']
  handleMoveEnd: ReturnType<typeof useMindMapViewport>['handleMoveEnd']
  preserveViewport: boolean
}


export function useMindMapCanvasState(
  props: UseMindMapCanvasStateProps,
): UseMindMapCanvasStateResult {
  const {
    graphData,
    selectedNodeId,
    editingNodeId = null,
    editingDraft = null,
    onNodeSelect,
    onEditingNodeChange,
    onEditingDraftChange,
    onAddChild,
    onAddSibling,
    onDelete,
    onDeleteNodeOnly,
    onReparent,
    onEdit,
    canUndo = false,
    canRedo = false,
    onUndo,
    onRedo,
    focusMode = false,
    onEdgeDelete,
    onEdgeInsert,
    onReorderSibling,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
    readonly = false,
    onNodeActivate,
    onNodeContextAction,
    onNodeHover,
    buildNodeActions: buildCustomNodeActions,
    practiceModeActive = false,
    mobileViewPolicy = 'auto',
    nodeClickViewportPolicy = 'guided-center',
    contentChangeViewportPolicy = 'auto-fit',
    viewCommand = null,
    toolbarVisible = true,
    onHostRefresh,
  } = props

  const measuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const isDraggingNodeRef = useRef(false)
  const displayNodesRef = useRef<Node[]>([])
  const displayEdgesRef = useRef<Edge[]>([])
  const [nodeSizeVersion, setNodeSizeVersion] = useState(0)
  const frameRef = useRef<HTMLDivElement>(null)
  const layouted = useMemo(
    () => {
      void nodeSizeVersion
      return applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    },
    [graphData, nodeSizeVersion],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges)

  const viewport = useMindMapViewport({
    frameRef,
    graphNodes: graphData.nodes,
    nodes,
    measuredNodeSizesRef,
    isDraggingNodeRef,
    focusMode,
    readonly,
    mobileViewPolicy,
    contentChangeViewportPolicy,
    practiceModeActive,
    toolbarVisible,
    viewCommand,
    setNodeSizeVersion,
  })
  const menus = useMindMapMenusAndEdges({
    onNodeSelect,
    onNodeActivate,
    onNodeContextAction,
    onNodeHover,
    onEdgeDelete,
    onEdgeInsert,
    mobileGuidedActive: viewport.mobileGuidedActive,
    contextActionOnly: practiceModeActive,
    nodeClickViewportPolicy,
    centerNodeInCanvas: viewport.centerNodeInCanvas,
  })
  const drag = useMindMapDragInteractions({
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
    checkOverlap: viewport.checkOverlap,
    flushPendingMeasuredNodeSizes: viewport.flushPendingMeasuredNodeSizes,
    closeEdgeMenu: menus.closeEdgeMenu,
    clearSelectedEdge: menus.clearEdgeSelection,
    resetPreviewFeedback: viewport.resetPreviewFeedback,
  })
  const {
    previewLayout,
    previewState,
    isDraggingNode,
    draggingNodeIdRef,
    handleFinishEdit,
    resetDragState,
  } = drag
  const { clearEdgeSelection } = menus
  const { runFitView } = viewport
  const touchLongPressEnabled = practiceModeActive
  const handleTouchLongPress = useCallback(
    (nodeId: string) => {
      onNodeContextAction?.(nodeId)
    },
    [onNodeContextAction],
  )
  const handleStartEdit = useCallback(
    (nodeId: string) => {
      if (readonly) return
      onNodeSelect(nodeId)
      onEditingNodeChange?.(nodeId)
    },
    [onEditingNodeChange, onNodeSelect, readonly],
  )
  const handleNodeDoubleClick = useCallback(
    (event: MouseEvent, node: Node) => {
      if (readonly) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('.mindmap-node-drag-handle')) return
      event.preventDefault()
      event.stopPropagation()
      onNodeSelect(node.id)
      onEditingNodeChange?.(node.id)
    },
    [onEditingNodeChange, onNodeSelect, readonly],
  )
  const handleCancelEdit = useCallback(
    (nodeId: string) => {
      if (editingNodeId === nodeId) onEditingNodeChange?.(null)
    },
    [editingNodeId, onEditingNodeChange],
  )
  const handleFinishEditAndClose = useCallback(
    (nodeId: string, text: string) => {
      handleFinishEdit(nodeId, text)
      if (editingNodeId === nodeId) onEditingNodeChange?.(null)
    },
    [editingNodeId, handleFinishEdit, onEditingNodeChange],
  )

  const displayNodes = useMemo(() => {
    const nextDisplayNodes = buildDisplayNodes({
      nodes,
      previewNodes: previewLayout?.nodes ?? [],
      previewState,
      previousDisplayNodes: displayNodesRef.current,
      sourceId: draggingNodeIdRef.current,
      isDraggingNode,
      selectedNodeId,
      editingNodeId,
      editingDraft,
      onStartEdit: handleStartEdit,
      onCancelEdit: handleCancelEdit,
      onEditTextChange: onEditingDraftChange,
      onAddChild,
      onAddSibling,
      onDelete,
      onFinishEdit: handleFinishEditAndClose,
      onMeasure: viewport.handleNodeMeasure,
      readonly,
      touchLongPressEnabled,
      onTouchLongPress: handleTouchLongPress,
    })
    displayNodesRef.current = nextDisplayNodes
    return nextDisplayNodes
  }, [draggingNodeIdRef, editingDraft, editingNodeId, handleCancelEdit, handleFinishEditAndClose, handleStartEdit, handleTouchLongPress, isDraggingNode, nodes, onAddChild, onAddSibling, onDelete, onEditingDraftChange, previewLayout, previewState, readonly, selectedNodeId, touchLongPressEnabled, viewport.handleNodeMeasure])

  const displayEdges = useMemo(() => {
    const baseEdges = previewLayout?.edges ?? edges
    const nextDisplayEdges = buildDisplayEdges(baseEdges, menus.selectedEdgeId, displayEdgesRef.current)
    displayEdgesRef.current = nextDisplayEdges
    return nextDisplayEdges
  }, [edges, menus.selectedEdgeId, previewLayout])

  const layoutAnchorNodeId = selectedNodeId ?? editingNodeId ?? graphData.nodes[0]?.id ?? null

  useEffect(() => {
    const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes((currentNodes) => {
      viewport.preserveNodeScreenPosition(layoutAnchorNodeId, currentNodes, nextLayout.nodes)
      return nextLayout.nodes
    })
    setEdges(nextLayout.edges)
    clearEdgeSelection()
    resetDragState()
  }, [clearEdgeSelection, graphData, layoutAnchorNodeId, resetDragState, setEdges, setNodes, viewport.preserveNodeScreenPosition])

  useEffect(() => {
    if (nodeSizeVersion === 0 || isDraggingNodeRef.current) return
    const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes((currentNodes) => {
      viewport.preserveNodeScreenPosition(layoutAnchorNodeId, currentNodes, nextLayout.nodes)
      return nextLayout.nodes
    })
    setEdges(nextLayout.edges)
  }, [graphData, layoutAnchorNodeId, nodeSizeVersion, setEdges, setNodes, viewport.preserveNodeScreenPosition])

  const nodeActions = useMemo(
    () => buildNodeActions({
      ctxMenu: menus.ctxMenu,
      buildCustomNodeActions,
      readonly,
      onAddChild,
      onAddSibling,
      onDelete,
      onDeleteNodeOnly,
      onStartEdit: handleStartEdit,
      isRootNode: (nodeId) => graphData.nodes.find((node) => node.id === nodeId)?.parentId == null,
      getSubtreeSize: (nodeId) => {
        const childrenByParent = new Map<string, string[]>()
        for (const node of graphData.nodes) {
          if (!node.parentId) continue
          const children = childrenByParent.get(node.parentId) ?? []
          children.push(node.id)
          childrenByParent.set(node.parentId, children)
        }
        let count = 0
        const stack = [nodeId]
        while (stack.length > 0) {
          const current = stack.pop()!
          count += 1
          stack.push(...(childrenByParent.get(current) ?? []))
        }
        return count
      },
      onMoveUp,
      onMoveDown,
      canMoveUp,
      canMoveDown,
    }),
    [buildCustomNodeActions, canMoveDown, canMoveUp, graphData.nodes, handleStartEdit, menus.ctxMenu, onAddChild, onAddSibling, onDelete, onDeleteNodeOnly, onMoveDown, onMoveUp, readonly],
  )
  const edgeActions = useMemo(
    () => buildEdgeActions({
      edgeMenu: menus.edgeMenu,
      onEdgeDelete: menus.handleEdgeDelete,
      onEdgeInsert: menus.handleEdgeInsert,
    }),
    [menus.edgeMenu, menus.handleEdgeDelete, menus.handleEdgeInsert],
  )

  const resetLayout = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'LAYOUT',
    })
    const { nodes: newNodes, edges: newEdges } = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes(newNodes)
    setEdges(newEdges)
    clearEdgeSelection()
    resetDragState()
    runFitView()
  }, [clearEdgeSelection, graphData, resetDragState, runFitView, setEdges, setNodes])

  const refreshCanvas = useCallback(() => {
    if (onHostRefresh) {
      onHostRefresh()
      return
    }
    resetLayout()
  }, [onHostRefresh, resetLayout])

  return {
    frameRef,
    ctxMenu: menus.ctxMenu,
    edgeMenu: menus.edgeMenu,
    canvasSize: viewport.canvasSize,
    isCanvasReady: viewport.isCanvasReady,
    displayNodes,
    displayEdges,
    isDraggingNode,
    mobileGuidedActive: viewport.mobileGuidedActive,
    nodeActions,
    edgeActions,
    canShowHistoryControls: Boolean(onUndo || onRedo),
    canUndo,
    canRedo,
    runFitView,
    zoomInCanvas: viewport.zoomInCanvas,
    zoomOutCanvas: viewport.zoomOutCanvas,
    resetLayout,
    refreshCanvas,
    closeNodeMenu: menus.closeNodeMenu,
    closeEdgeMenu: menus.closeEdgeMenu,
    onNodesChange,
    onEdgesChange,
    handleNodeClick: menus.handleNodeClick,
    handleNodeDoubleClick,
    handleNodeContextMenu: menus.handleNodeContextMenu,
    handleNodeMouseEnter: menus.handleNodeMouseEnter,
    handleNodeMouseLeave: menus.handleNodeMouseLeave,
    handleNodeDragStart: drag.handleNodeDragStart,
    handleNodeDrag: drag.handleNodeDrag,
    handleNodeDragStop: drag.handleNodeDragStop,
    handleEdgeClick: menus.handleEdgeClick,
    handleEdgeDoubleClick: menus.handleEdgeDoubleClick,
    handlePaneClick: menus.handlePaneClick,
    handleMoveStart: viewport.handleMoveStart,
    handleMove: viewport.handleMove,
    handleMoveEnd: viewport.handleMoveEnd,
    preserveViewport: viewport.preserveViewport,
  }
}
