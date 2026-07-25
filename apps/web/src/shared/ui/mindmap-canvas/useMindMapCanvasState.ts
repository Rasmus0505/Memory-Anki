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
import {
  expandAncestorsForNode,
  reconcileCollapsedNodeIds,
  toggleCollapsedNodeId,
  expandSubtreeCollapsedIds,
} from './mindMapCollapse'
import { useMindMapDragInteractions } from './useMindMapDragInteractions'
import { useMindMapMenusAndEdges } from './useMindMapMenusAndEdges'
import { useMindMapViewport } from './useMindMapViewport'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  readMarkColorLabelsSettings,
  setLastUsedMarkColor,
} from '@/shared/preferences/markColorLabels'
import type { MindMapCanvasProps } from './MindMapCanvas'

export interface MarkColorFlyoutState {
  x: number
  y: number
  nodeIds: string[]
  currentColor: string | null
}

type UseMindMapCanvasStateProps = MindMapCanvasProps & {
  toolbarVisible?: boolean
  onHostRefresh?: () => void
  hostRefreshEpoch?: number
  controlledViewport: Viewport
  onControlledViewportChange: (viewport: Viewport) => void
}

/** True when layout output is visually identical — used to skip no-op React Flow writes. */
function isSameMindMapLayout(current: Node[], next: Node[]): boolean {
  if (current === next) return true
  if (current.length !== next.length) return false
  const currentById = new Map(current.map((node) => [node.id, node]))
  for (const node of next) {
    const previous = currentById.get(node.id)
    if (!previous) return false
    if (
      previous.position.x !== node.position.x
      || previous.position.y !== node.position.y
      || previous.type !== node.type
      || previous.sourcePosition !== node.sourcePosition
      || previous.targetPosition !== node.targetPosition
    ) {
      return false
    }
    // Layout nodes carry label/visual metadata in data; handlers are added later in display.
    if (JSON.stringify(previous.data) !== JSON.stringify(node.data)) return false
  }
  return true
}

function isSameMindMapEdges(current: Edge[], next: Edge[]): boolean {
  if (current === next) return true
  if (current.length !== next.length) return false
  const currentById = new Map(current.map((edge) => [edge.id, edge]))
  for (const edge of next) {
    const previous = currentById.get(edge.id)
    if (!previous) return false
    if (
      previous.source !== edge.source
      || previous.target !== edge.target
      || previous.type !== edge.type
      || previous.label !== edge.label
      || JSON.stringify(previous.style) !== JSON.stringify(edge.style)
    ) {
      return false
    }
  }
  return true
}

export interface UseMindMapCanvasStateResult {
  frameRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLDivElement | null>
  ctxMenu: { x: number; y: number; nodeId: string; targetNodeIds: string[] } | null
  edgeMenu: { x: number; y: number; edgeId: string; sourceId: string; targetId: string } | null
  canvasSize: { width: number; height: number }
  isCanvasReady: boolean
  displayNodes: Node[]
  displayEdges: Edge[]
  isDraggingNode: boolean
  mobileGuidedActive: boolean
  nodeActions: ContextMenuAction[]
  edgeActions: ContextMenuAction[]
  markColorFlyout: MarkColorFlyoutState | null
  canShowHistoryControls: boolean
  canUndo: boolean
  canRedo: boolean
  runFitView: (duration?: number) => void
  fitSelectionBranch: () => void
  expandSelectionSubtree: () => void
  expandSubtree: (nodeId: string) => void
  expandAllBranches: () => void
  collapseDeepBranches: () => void
  zoomInCanvas: () => void
  zoomOutCanvas: () => void
  resetLayout: () => void
  refreshCanvas: () => void
  closeNodeMenu: () => void
  closeEdgeMenu: () => void
  closeMarkColorFlyout: () => void
  pickMarkColor: (color: string) => void
  clearMarkColor: () => void
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
    onDeleteNodes,
    onDeleteNodeOnly,
    onHighlightNodes,
    onMarkColorNodes,
    onToggleQuestionCards,
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
    englishInteractionActive = false,
    onEnglishWordClick,
    mobileViewPolicy = 'auto',
    nodeClickViewportPolicy = 'preserve',
    contentChangeViewportPolicy = 'preserve',
    sceneTransitionKey = null,
    viewCommand = null,
    onHostRefresh,
    hostRefreshEpoch = 0,
    controlledViewport,
    onControlledViewportChange,
  } = props

  const measuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const [markColorFlyout, setMarkColorFlyout] = useState<MarkColorFlyoutState | null>(null)
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() =>
    reconcileCollapsedNodeIds(new Set(), graphData.nodes, {
      practiceModeActive,
      forceDefault: true,
    }),
  )
  const collapsedSignatureRef = useRef('')

  const resolveCurrentMarkColor = useCallback((nodeIds: string[]) => {
    for (const id of nodeIds) {
      const node = graphData.nodes.find((item) => item.id === id)
      const raw = node?.metadata?.markColor
      if (typeof raw === 'string' && raw.trim()) return raw.trim()
      const visual = (node?.metadata?.visual ?? {}) as { fillColor?: string | null }
      if (typeof visual.fillColor === 'string' && visual.fillColor.trim()) {
        return visual.fillColor.trim()
      }
    }
    return readMarkColorLabelsSettings().lastUsedColor
  }, [graphData.nodes])

  const openMarkColorPalette = useCallback((nodeIds: string[], point: { x: number; y: number }) => {
    if (!onMarkColorNodes || nodeIds.length === 0) return
    setMarkColorFlyout({
      x: point.x,
      y: point.y,
      nodeIds: [...nodeIds],
      currentColor: resolveCurrentMarkColor(nodeIds),
    })
  }, [onMarkColorNodes, resolveCurrentMarkColor])

  const applyLastMarkColor = useCallback((nodeIds: string[]) => {
    if (!onMarkColorNodes || nodeIds.length === 0) return
    const last = readMarkColorLabelsSettings().lastUsedColor
    if (last) {
      onMarkColorNodes(nodeIds, last)
      return
    }
    // No last-used color yet — open palette near default corner.
    openMarkColorPalette(nodeIds, { x: window.innerWidth / 2 - 120, y: window.innerHeight / 2 - 120 })
  }, [onMarkColorNodes, openMarkColorPalette])

  const pickMarkColor = useCallback((color: string) => {
    if (!markColorFlyout || !onMarkColorNodes) return
    onMarkColorNodes(markColorFlyout.nodeIds, color)
    setLastUsedMarkColor(color)
    setMarkColorFlyout(null)
  }, [markColorFlyout, onMarkColorNodes])

  const clearMarkColor = useCallback(() => {
    if (!markColorFlyout || !onMarkColorNodes) return
    onMarkColorNodes(markColorFlyout.nodeIds, null)
    setMarkColorFlyout(null)
  }, [markColorFlyout, onMarkColorNodes])

  const closeMarkColorFlyout = useCallback(() => {
    setMarkColorFlyout(null)
  }, [])
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
      return applyMindMapLayout(graphData, measuredNodeSizesRef.current, collapsedNodeIds)
    },
    [collapsedNodeIds, graphData, nodeSizeVersion],
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
    sceneTransitionKey,
    viewCommand,
    hostRefreshEpoch,
    setNodeSizeVersion,
  })
  const selectedNodeIds = useMemo(() => {
    if (selectedNodeIdsProp && selectedNodeIdsProp.length > 0) return selectedNodeIdsProp
    return selectedNodeId ? [selectedNodeId] : []
  }, [selectedNodeId, selectedNodeIdsProp])

  // Reconcile collapse when the node-id set or practice mode changes.
  // Practice/review keep fully expanded so flip reveal is not fighting folds.
  // Editing keeps user folds for surviving parents; only brand-new deep parents
  // auto-fold on large maps. Mode switches re-seed defaults.
  useEffect(() => {
    const modeKey = practiceModeActive ? 'p' : 'e'
    const idSignature = graphData.nodes.map((node) => node.id).join(',')
    const signature = `${modeKey}:${idSignature}`
    const previousSignature = collapsedSignatureRef.current
    collapsedSignatureRef.current = signature
    if (!previousSignature) {
      setCollapsedNodeIds(
        reconcileCollapsedNodeIds(new Set(), graphData.nodes, {
          practiceModeActive,
          forceDefault: true,
        }),
      )
      return
    }
    const previousMode = previousSignature.startsWith('p:') ? 'p' : 'e'
    const modeChanged = previousMode !== modeKey
    setCollapsedNodeIds((previous) =>
      reconcileCollapsedNodeIds(previous, graphData.nodes, {
        practiceModeActive,
        forceDefault: modeChanged,
      }),
    )
  }, [graphData.nodes, practiceModeActive])

  // Expand ancestors when host selects a node that would otherwise be hidden.
  useEffect(() => {
    if (!selectedNodeId) return
    setCollapsedNodeIds((previous) => {
      const next = expandAncestorsForNode(graphData.nodes, previous, selectedNodeId)
      if (next.size === previous.size) {
        let same = true
        for (const id of previous) {
          if (!next.has(id)) {
            same = false
            break
          }
        }
        if (same) return previous
      }
      return next
    })
  }, [graphData.nodes, selectedNodeId])

  const handleToggleCollapse = useCallback((nodeId: string) => {
    setCollapsedNodeIds((previous) => toggleCollapsedNodeId(previous, nodeId))
  }, [])

  const expandAllBranches = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'EXPAND_ALL',
    })
    setCollapsedNodeIds(new Set())
  }, [])

  const collapseDeepBranches = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'COLLAPSE_DEEP',
    })
    setCollapsedNodeIds(
      reconcileCollapsedNodeIds(new Set(), graphData.nodes, {
        practiceModeActive: false,
        forceDefault: true,
      }),
    )
  }, [graphData.nodes])

  const expandSubtree = useCallback(
    (nodeId: string) => {
      if (!nodeId || practiceModeActive) return
      dispatchGlobalFeedback('toolbar_action', {
        origin: 'toolbar',
        label: 'EXPAND_SUBTREE',
      })
      setCollapsedNodeIds((previous) =>
        expandSubtreeCollapsedIds(graphData.nodes, previous, nodeId),
      )
    },
    [graphData.nodes, practiceModeActive],
  )

  const expandSelectionSubtree = useCallback(() => {
    const focusId =
      selectedNodeId
      ?? selectedNodeIds[0]
      ?? null
    if (!focusId) return
    expandSubtree(focusId)
  }, [expandSubtree, selectedNodeId, selectedNodeIds])

  const fitSelectionBranch = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'FIT_BRANCH',
    })
    const focusId =
      selectedNodeId
      ?? selectedNodeIds[0]
      ?? graphData.nodes.find((node) => node.parentId == null)?.id
      ?? null
    viewport.fitNodesInView(focusId ? [focusId] : null, {
      includeDescendants: true,
      duration: 240,
    })
  }, [graphData.nodes, selectedNodeId, selectedNodeIds, viewport])


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
    selectedNodeIds,
    readonly,
  })
  const drag = useMindMapDragInteractions({
    readonly,
    graphData,
    collapsedNodeIds,
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
  // Practice: long-press = hide branch (via contextActionOnly). Edit: long-press = desktop right-click menu.
  const touchLongPressEnabled =
    (practiceModeActive || !readonly) && !englishInteractionActive
  const handleTouchLongPress = useCallback(
    (nodeId: string, point: { x: number; y: number }) => {
      menus.openNodeContext(nodeId, point)
    },
    [menus],
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
      // Yellow emphasis spans live under .mindmap-node-text; also treat data-emphasis
      // as text so RF fallback still enters edit if DOM nesting is unusual (browser
      // reparenting of <div> highlight markup out of an invalid <span> wrapper).
      const onCardText =
        Boolean(target?.closest('.mindmap-node-text'))
        || Boolean(target?.closest('[data-emphasis="highlight"]'))
        || Boolean(target?.closest('.mindmap-rich-text'))
      if (target?.closest('.mindmap-node-drag-surface') && !onCardText) {
        // Dragging the selected surface should not fall through to edit.
        return
      }
      // NodeCard handles double-click first (stopPropagation). RF path is a
      // fallback when the event still reaches the node wrapper (e.g. reparented
      // highlight DOM). Always re-assert edit — beginEditing is idempotent.
      event.preventDefault()
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
      onToggleCollapse: practiceModeActive ? undefined : handleToggleCollapse,
      onExpandSubtree: practiceModeActive ? undefined : expandSubtree,
      onExtractSelection: onExtractSelection ? handleExtractSelection : undefined,
      onExtractDropPreview: onExtractSelection ? handleExtractDropPreview : undefined,
      readonly,
      touchLongPressEnabled,
      onTouchLongPress: handleTouchLongPress,
      buildSelectionToolbarActions: props.buildSelectionToolbarActions,
      selectionToolbarPreferPosition: props.selectionToolbarPreferPosition,
      extractDropTargetId: extractDrop?.targetId ?? null,
      extractDropMode: extractDrop?.mode ?? null,
      englishInteractionActive,
      onEnglishWordClick,
    })
    displayNodesRef.current = nextDisplayNodes
    return nextDisplayNodes
  // liveDragVersion is a bump counter so ref-backed live drag positions re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- liveDragVersion forces recompute when only refs change
  }, [dragSourceIdsRef, draggingNodeIdRef, editingDraft, editingNodeId, englishInteractionActive, extractDrop, handleCancelEdit, handleExtractDropPreview, handleExtractSelection, handleFinishEditAndClose, handleStartEdit, expandSubtree, handleToggleCollapse, handleTouchLongPress, isDraggingNode, liveDragPositionsRef, liveDragVersion, nodes, onAddChild, onAddSibling, onDelete, onEditingDraftChange, onEnglishWordClick, onExtractSelection, practiceModeActive, previewState, props.buildSelectionToolbarActions, props.selectionToolbarPreferPosition, props.onCountBadgeClick, readonly, selectEditingText, selectedNodeId, selectedNodeIds, touchLongPressEnabled, viewport.handleNodeMeasure])

  const displayEdges = useMemo(() => {
    const nextDisplayEdges = buildDisplayEdges(edges, menus.selectedEdgeId, displayEdgesRef.current)
    displayEdgesRef.current = nextDisplayEdges
    return nextDisplayEdges
  }, [edges, menus.selectedEdgeId])

  const applyGraphLayout = useCallback(
    (options?: { resetDrag?: boolean }) => {
      const nextLayout = applyMindMapLayout(
        graphData,
        measuredNodeSizesRef.current,
        collapsedNodeIds,
      )
      // Skip identical layouts so timer/parent re-renders with a new graphData identity
      // but the same structure do not force React Flow node replacement (review flicker).
      setNodes((current) => (isSameMindMapLayout(current, nextLayout.nodes) ? current : nextLayout.nodes))
      setEdges((current) => (isSameMindMapEdges(current, nextLayout.edges) ? current : nextLayout.edges))
      if (options?.resetDrag) {
        clearEdgeSelection()
        resetDragState()
      }
    },
    [clearEdgeSelection, collapsedNodeIds, graphData, resetDragState, setEdges, setNodes],
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
      onDeleteNodes,
      onDeleteNodeOnly,
      onHighlightNodes,
      onApplyLastMarkColor: onMarkColorNodes ? applyLastMarkColor : undefined,
      onOpenMarkColorPalette: onMarkColorNodes ? openMarkColorPalette : undefined,
      markColorSwatch: readMarkColorLabelsSettings().lastUsedColor,
      onToggleQuestionCards,
      isQuestionCard: (nodeId) => {
        const node = graphData.nodes.find((item) => item.id === nodeId)
        return node?.metadata?.memoryAnkiQuestionCard === true
      },
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
    [
      buildCustomNodeActions,
      canMoveDown,
      canMoveUp,
      graphData.nodes,
      handleStartEdit,
      menus.ctxMenu,
      onAddChild,
      onAddSibling,
      onDelete,
      onDeleteNodeOnly,
      onDeleteNodes,
      onHighlightNodes,
      onMarkColorNodes,
      applyLastMarkColor,
      openMarkColorPalette,
      onToggleQuestionCards,
      onMoveDown,
      onMoveUp,
      readonly,
    ],
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
    const { nodes: newNodes, edges: newEdges } = applyMindMapLayout(
      graphData,
      measuredNodeSizesRef.current,
      collapsedNodeIds,
    )
    setNodes(newNodes)
    setEdges(newEdges)
    clearEdgeSelection()
    resetDragState()
    runFitView()
  }, [clearEdgeSelection, collapsedNodeIds, graphData, resetDragState, runFitView, setEdges, setNodes])

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
    markColorFlyout,
    canShowHistoryControls: Boolean(onUndo || onRedo),
    canUndo,
    canRedo,
    runFitView,
    fitSelectionBranch,
    expandSelectionSubtree,
    expandSubtree,
    expandAllBranches,
    collapseDeepBranches,
    zoomInCanvas: viewport.zoomInCanvas,
    zoomOutCanvas: viewport.zoomOutCanvas,
    resetLayout,
    refreshCanvas,
    closeNodeMenu: menus.closeNodeMenu,
    closeEdgeMenu: menus.closeEdgeMenu,
    closeMarkColorFlyout,
    pickMarkColor,
    clearMarkColor,
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
