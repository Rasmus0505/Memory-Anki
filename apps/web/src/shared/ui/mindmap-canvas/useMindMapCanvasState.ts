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
  type Viewport,
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
  controlledViewport: Viewport
  onControlledViewportChange: (viewport: Viewport) => void
}

export interface UseMindMapCanvasStateResult {
  frameRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLDivElement | null>
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
  handleViewportChange: ReturnType<typeof useMindMapViewport>['handleViewportChange']
  preserveViewport: boolean
  controlledViewport: Viewport
}


export function useMindMapCanvasState(
  props: UseMindMapCanvasStateProps,
): UseMindMapCanvasStateResult {
  const {
    graphData,
    selectedNodeId,
    selectedNodeIds: selectedNodeIdsProp,
    editingNodeId = null,
    editingDraft = null,
    selectEditingText = false,
    onNodeSelect,
    onEditingNodeChange,
    onEditingDraftChange,
    onAddChild,
    onAddSibling,
    onDelete,
    onDeleteNodeOnly,
    onRelocate,
    onReparent,
    onExtractSelection,
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
    nodeClickViewportPolicy = 'preserve',
    contentChangeViewportPolicy = 'preserve',
    viewCommand = null,
    onHostRefresh,
    controlledViewport,
    onControlledViewportChange,
  } = props

  const measuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const isDraggingNodeRef = useRef(false)
  /** Graph/measure layout landed while a structure drag was active — apply after drag ends. */
  const pendingLayoutSyncRef = useRef(false)
  const displayNodesRef = useRef<Node[]>([])
  const displayEdgesRef = useRef<Edge[]>([])
  const [nodeSizeVersion, setNodeSizeVersion] = useState(0)
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
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
    canvasRef,
    controlledViewport,
    onControlledViewportChange,
    graphNodes: graphData.nodes,
    nodes,
    measuredNodeSizesRef,
    isDraggingNodeRef,
    focusMode,
    readonly,
    mobileViewPolicy,
    contentChangeViewportPolicy,
    viewCommand,
    setNodeSizeVersion,
  })
  const selectedNodeIds = useMemo(() => {
    if (selectedNodeIdsProp && selectedNodeIdsProp.length > 0) return selectedNodeIdsProp
    return selectedNodeId ? [selectedNodeId] : []
  }, [selectedNodeId, selectedNodeIdsProp])

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
    readonly,
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
    selectedNodeIds,
    onEdit,
    onRelocate,
    onReparent,
    onReorderSibling,
    checkOverlap: viewport.checkOverlap,
    flushPendingMeasuredNodeSizes: viewport.flushPendingMeasuredNodeSizes,
    closeEdgeMenu: menus.closeEdgeMenu,
    clearSelectedEdge: menus.clearEdgeSelection,
    resetPreviewFeedback: viewport.resetPreviewFeedback,
  })
  const {
    previewState,
    isDraggingNode,
    liveDragVersion,
    liveDragPositionsRef,
    draggingNodeIdRef,
    dragSourceIdsRef,
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
      // Enter edit in one step: surface beginEditing already selects the node.
      // Avoid select→edit double-write races that can drop the edit session.
      onEditingNodeChange?.(nodeId)
    },
    [onEditingNodeChange, readonly],
  )
  const handleNodeDoubleClick = useCallback(
    (event: MouseEvent, node: Node) => {
      if (readonly) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('.mindmap-node-drag-surface') && !target.closest('.mindmap-node-text')) {
        // Dragging the selected surface should not fall through to edit.
        return
      }
      // NodeCard also handles double-click; RF path is a fallback when the
      // event does not originate from card shell handlers.
      if (target?.closest('[data-mindmap-node-id]')) return
      event.preventDefault()
      event.stopPropagation()
      onEditingNodeChange?.(node.id)
    },
    [onEditingNodeChange, readonly],
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

  const [extractDrop, setExtractDrop] = useState<{
    targetId: string
    mode: 'before' | 'inside' | 'after'
  } | null>(null)

  const handleExtractDropPreview = useCallback(
    (next: { targetId: string; mode: 'before' | 'inside' | 'after' } | null) => {
      setExtractDrop(next)
    },
    [],
  )

  const handleExtractSelection = useCallback(
    (payload: {
      sourceId: string
      liveText: string
      start: number
      end: number
      placement: { mode: 'inside' | 'before' | 'after'; targetUid: string }
    }) => {
      setExtractDrop(null)
      onExtractSelection?.(payload)
    },
    [onExtractSelection],
  )

  const displayNodes = useMemo(() => {
    const nextDisplayNodes = buildDisplayNodes({
      nodes,
      // Structure drag freezes layout: only drop chrome / source ghost, no position preview.
      previewNodes: [],
      previewState,
      previousDisplayNodes: displayNodesRef.current,
      sourceId: draggingNodeIdRef.current,
      sourceIds: dragSourceIdsRef.current,
      isDraggingNode,
      liveDragPositions: isDraggingNode ? liveDragPositionsRef.current : null,
      selectedNodeId,
      selectedNodeIds,
      editingNodeId,
      editingDraft,
      selectEditingText,
      onStartEdit: handleStartEdit,
      onCancelEdit: handleCancelEdit,
      onEditTextChange: onEditingDraftChange,
      onAddChild,
      onAddSibling,
      onDelete,
      onFinishEdit: handleFinishEditAndClose,
      onMeasure: viewport.handleNodeMeasure,
      onCountBadgeClick: props.onCountBadgeClick,
      onExtractSelection: onExtractSelection ? handleExtractSelection : undefined,
      onExtractDropPreview: onExtractSelection ? handleExtractDropPreview : undefined,
      readonly,
      touchLongPressEnabled,
      onTouchLongPress: handleTouchLongPress,
      buildSelectionToolbarActions: props.buildSelectionToolbarActions,
      selectionToolbarPreferPosition: props.selectionToolbarPreferPosition,
      extractDropTargetId: extractDrop?.targetId ?? null,
      extractDropMode: extractDrop?.mode ?? null,
    })
    displayNodesRef.current = nextDisplayNodes
    return nextDisplayNodes
  // liveDragVersion is a bump counter so ref-backed live drag positions re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- liveDragVersion forces recompute when only refs change
  }, [dragSourceIdsRef, draggingNodeIdRef, editingDraft, editingNodeId, extractDrop, handleCancelEdit, handleExtractDropPreview, handleExtractSelection, handleFinishEditAndClose, handleStartEdit, handleTouchLongPress, isDraggingNode, liveDragPositionsRef, liveDragVersion, nodes, onAddChild, onAddSibling, onDelete, onEditingDraftChange, onExtractSelection, previewState, props.buildSelectionToolbarActions, props.selectionToolbarPreferPosition, props.onCountBadgeClick, readonly, selectEditingText, selectedNodeId, selectedNodeIds, touchLongPressEnabled, viewport.handleNodeMeasure])

  const displayEdges = useMemo(() => {
    const nextDisplayEdges = buildDisplayEdges(edges, menus.selectedEdgeId, displayEdgesRef.current)
    displayEdgesRef.current = nextDisplayEdges
    return nextDisplayEdges
  }, [edges, menus.selectedEdgeId])

  const applyGraphLayout = useCallback(
    (options?: { resetDrag?: boolean }) => {
      const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
      setNodes(nextLayout.nodes)
      setEdges(nextLayout.edges)
      if (options?.resetDrag) {
        clearEdgeSelection()
        resetDragState()
      }
    },
    [clearEdgeSelection, graphData, resetDragState, setEdges, setNodes],
  )

  useEffect(() => {
    // Mid-drag layout resets are the main "flash back to origin" source.
    if (isDraggingNodeRef.current) {
      pendingLayoutSyncRef.current = true
      return
    }
    pendingLayoutSyncRef.current = false
    applyGraphLayout({ resetDrag: true })
  }, [applyGraphLayout])

  useEffect(() => {
    if (nodeSizeVersion === 0) return
    if (isDraggingNodeRef.current) {
      pendingLayoutSyncRef.current = true
      return
    }
    applyGraphLayout()
  }, [applyGraphLayout, nodeSizeVersion])

  // After a structure drag ends, flush any graph/measure layout deferred above.
  useEffect(() => {
    if (isDraggingNode) return
    if (!pendingLayoutSyncRef.current) return
    pendingLayoutSyncRef.current = false
    applyGraphLayout()
  }, [applyGraphLayout, isDraggingNode])

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
    canvasRef,
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
    handleViewportChange: viewport.handleViewportChange,
    preserveViewport: viewport.preserveViewport,
    controlledViewport: viewport.controlledViewport,
  }
}
