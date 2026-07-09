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
  handleNodeContextMenu: (event: MouseEvent, node: Node) => void
  handleNodeMouseEnter: (event: MouseEvent, node: Node) => void
  handleNodeMouseLeave: (event: MouseEvent, node: Node) => void
  handleNodeDragStart: (event: unknown, node: Node) => void
  handleNodeDrag: (event: unknown, node: Node) => void
  handleNodeDragStop: (event: unknown, node: Node) => void
  handleEdgeClick: EdgeMouseHandler
  handleEdgeDoubleClick: EdgeMouseHandler
  handlePaneClick: () => void
}

export function useMindMapCanvasState(
  props: UseMindMapCanvasStateProps,
): UseMindMapCanvasStateResult {
  const {
    graphData,
    selectedNodeId,
    onNodeSelect,
    onAddChild,
    onAddSibling,
    onDelete,
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
  const touchLongPressEnabled = useMemo(() => {
    if (!practiceModeActive) return false
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(pointer: coarse)').matches
  }, [practiceModeActive])
  const handleTouchLongPress = useCallback(
    (nodeId: string) => {
      onNodeContextAction?.(nodeId)
    },
    [onNodeContextAction],
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
      onAddChild,
      onDelete,
      onFinishEdit: handleFinishEdit,
      onMeasure: viewport.handleNodeMeasure,
      readonly,
      touchLongPressEnabled,
      onTouchLongPress: handleTouchLongPress,
    })
    displayNodesRef.current = nextDisplayNodes
    return nextDisplayNodes
  }, [draggingNodeIdRef, handleFinishEdit, handleTouchLongPress, isDraggingNode, nodes, onAddChild, onDelete, previewLayout, previewState, readonly, selectedNodeId, touchLongPressEnabled, viewport.handleNodeMeasure])

  const displayEdges = useMemo(() => {
    const baseEdges = previewLayout?.edges ?? edges
    const nextDisplayEdges = buildDisplayEdges(baseEdges, menus.selectedEdgeId, displayEdgesRef.current)
    displayEdgesRef.current = nextDisplayEdges
    return nextDisplayEdges
  }, [edges, menus.selectedEdgeId, previewLayout])

  useEffect(() => {
    const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes(nextLayout.nodes)
    setEdges(nextLayout.edges)
    clearEdgeSelection()
    resetDragState()
  }, [clearEdgeSelection, graphData, resetDragState, setEdges, setNodes])

  useEffect(() => {
    if (nodeSizeVersion === 0 || isDraggingNodeRef.current) return
    const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes(nextLayout.nodes)
    setEdges(nextLayout.edges)
  }, [graphData, nodeSizeVersion, setEdges, setNodes])

  const nodeActions = useMemo(
    () => buildNodeActions({
      ctxMenu: menus.ctxMenu,
      buildCustomNodeActions,
      readonly,
      onAddChild,
      onAddSibling,
      onDelete,
      onMoveUp,
      onMoveDown,
      canMoveUp,
      canMoveDown,
    }),
    [buildCustomNodeActions, canMoveDown, canMoveUp, menus.ctxMenu, onAddChild, onAddSibling, onDelete, onMoveDown, onMoveUp, readonly],
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
    handleNodeContextMenu: menus.handleNodeContextMenu,
    handleNodeMouseEnter: menus.handleNodeMouseEnter,
    handleNodeMouseLeave: menus.handleNodeMouseLeave,
    handleNodeDragStart: drag.handleNodeDragStart,
    handleNodeDrag: drag.handleNodeDrag,
    handleNodeDragStop: drag.handleNodeDragStop,
    handleEdgeClick: menus.handleEdgeClick,
    handleEdgeDoubleClick: menus.handleEdgeDoubleClick,
    handlePaneClick: menus.handlePaneClick,
  }
}
