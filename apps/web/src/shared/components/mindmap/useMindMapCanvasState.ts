import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
} from '@xyflow/react'
import {
  ArrowDown,
  ArrowUp,
  BetweenHorizontalStart,
  Pencil,
  Plus,
  Trash2,
  Unlink,
} from 'lucide-react'
import type { ContextMenuAction } from './NodeContextMenu'
import {
  applyMindMapLayout,
  buildPreviewGraph,
  DROP_HIT_PADDING_X,
  DROP_HIT_PADDING_Y,
  getResolvedNodeSize,
  isDescendant,
  type DropMode,
  type NodeSize,
  type NodeSizeMap,
  type PreviewState,
  TOOLBAR_HEIGHT,
} from './layout'
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

function getEventFeedbackPoint(event: unknown) {
  if (!event || typeof event !== 'object') return undefined
  const candidate = event as { clientX?: unknown; clientY?: unknown }
  return typeof candidate.clientX === 'number' && typeof candidate.clientY === 'number'
    ? { x: candidate.clientX, y: candidate.clientY }
    : undefined
}

function isTouchPrimaryInputDevice() {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    return true
  }
  if (typeof navigator === 'undefined') return false
  return Number(navigator.maxTouchPoints || 0) > 0
}

function hasMeaningfulSizeChange(
  sizes: NodeSizeMap,
  nodeId: string,
  nextSize: NodeSize,
) {
  const previousSize = sizes.get(nodeId)
  return (
    !previousSize ||
    Math.abs(previousSize.width - nextSize.width) > 1 ||
    Math.abs(previousSize.height - nextSize.height) > 1
  )
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
    buildNodeActions,
    practiceModeActive = false,
    mobileViewPolicy = 'auto',
    viewCommand = null,
    toolbarVisible = true,
    onHostRefresh,
  } = props

  const measuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const pendingMeasuredNodeSizesRef = useRef<Map<string, NodeSize>>(new Map())
  const isDraggingNodeRef = useRef(false)
  const [nodeSizeVersion, setNodeSizeVersion] = useState(0)

  const layouted = useMemo(
    () => {
      void nodeSizeVersion
      return applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    },
    [graphData, nodeSizeVersion],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges)
  const { fitView, zoomIn, zoomOut, setCenter } = useReactFlow()

  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    nodeId: string
  } | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{
    x: number
    y: number
    edgeId: string
    sourceId: string
    targetId: string
  } | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const [isDraggingNode, setIsDraggingNode] = useState(false)
  const previewStateRef = useRef<PreviewState | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const pendingDragRef = useRef<{ event: unknown; node: Node } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const lastPreviewFeedbackRef = useRef('')
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const frameRef = useRef<HTMLDivElement>(null)
  const handledViewCommandNonceRef = useRef<number | null>(null)
  const isCanvasReady = canvasSize.width > 0 && canvasSize.height > 0
  const touchLongPressEnabled = practiceModeActive && isTouchPrimaryInputDevice()
  const mobileGuidedActive =
    mobileViewPolicy === 'guided' ||
    (mobileViewPolicy === 'auto' &&
      readonly &&
      canvasSize.width > 0 &&
      canvasSize.width < 768)

  const previewLayout = useMemo(
    () => {
      void nodeSizeVersion
      return previewState
        ? buildPreviewGraph(graphData, previewState, measuredNodeSizesRef.current)
        : null
    },
    [graphData, nodeSizeVersion, previewState],
  )

  useEffect(() => {
    previewStateRef.current = previewState
  }, [previewState])

  useEffect(() => {
    isDraggingNodeRef.current = isDraggingNode
  }, [isDraggingNode])

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current)
      }
    }
  }, [])

  const runFitView = useCallback(
    (duration = 300) => {
      if (!isCanvasReady) return
      requestAnimationFrame(() => {
        fitView({
          duration,
          padding: mobileGuidedActive ? 0.18 : focusMode ? 0.03 : 0.06,
          includeHiddenNodes: true,
          minZoom: mobileGuidedActive ? 0.34 : 0.42,
          maxZoom: mobileGuidedActive ? 1.02 : 1.15,
        })
      })
    },
    [fitView, focusMode, isCanvasReady, mobileGuidedActive],
  )

  const centerNodeInCanvas = useCallback(
    (nodeId: string | null | undefined, duration = 240) => {
      if (!nodeId || !isCanvasReady) return
      const target = (readonly && !isDraggingNode ? layouted.nodes : nodes).find(
        (node) => node.id === nodeId,
      )
      if (!target) return
      const size = getResolvedNodeSize(target, undefined, measuredNodeSizesRef.current)
      setCenter(
        target.position.x + size.width / 2,
        target.position.y + size.height / 2,
        {
          duration,
          zoom: mobileGuidedActive ? 1.02 : undefined,
        },
      )
    },
    [isCanvasReady, isDraggingNode, layouted.nodes, mobileGuidedActive, nodes, readonly, setCenter],
  )

  useLayoutEffect(() => {
    const element = frameRef.current
    if (!element) return

    const updateSize = () => {
      setCanvasSize({
        width: element.clientWidth,
        height: Math.max(
          element.clientHeight - (toolbarVisible ? TOOLBAR_HEIGHT : 0),
          0,
        ),
      })
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [toolbarVisible])

  const checkOverlap = useCallback(
    (dragId: string, draggedNode?: Node, event?: unknown) => {
      const dragNode = nodes.find((node) => node.id === dragId)
      const activeNode = draggedNode ?? dragNode
      if (!activeNode) return

      const measuredSizes = measuredNodeSizesRef.current
      const activeSize = getResolvedNodeSize(activeNode, undefined, measuredSizes)
      const cx = activeNode.position.x + activeSize.width / 2
      const cy = activeNode.position.y + activeSize.height / 2
      let closest: { id: string; dist: number; mode: DropMode } | null = null

      for (const node of nodes) {
        if (node.id === dragId) continue
        if (isDescendant(graphData.nodes, dragId, node.id)) continue
        const { width, height } = getResolvedNodeSize(node, undefined, measuredSizes)
        const nx = node.position.x + width / 2
        const ny = node.position.y + height / 2
        const dist = Math.sqrt((cx - nx) ** 2 + (cy - ny) ** 2)
        const withinX =
          cx >= node.position.x - DROP_HIT_PADDING_X &&
          cx <= node.position.x + width + DROP_HIT_PADDING_X
        const withinY =
          cy >= node.position.y - DROP_HIT_PADDING_Y &&
          cy <= node.position.y + height + DROP_HIT_PADDING_Y
        if ((withinX && withinY) || dist < Math.max(width, 96)) {
          const relativeY = cy - node.position.y
          const mode =
            relativeY < height * 0.28
              ? 'before'
              : relativeY > height * 0.72
                ? 'after'
                : 'inside'
          if (!closest || dist < closest.dist) {
            closest = { id: node.id, dist, mode }
          }
        }
      }

      const nextSignature = closest ? `${dragId}:${closest.id}:${closest.mode}` : ''
      if (nextSignature === lastPreviewFeedbackRef.current) return
      if (nextSignature && nextSignature !== lastPreviewFeedbackRef.current) {
        dispatchGlobalFeedback('node_move', {
          point: getEventFeedbackPoint(event),
          origin: 'node',
        })
      }
      lastPreviewFeedbackRef.current = nextSignature
      setPreviewState(closest ? { sourceId: dragId, targetId: closest.id, mode: closest.mode } : null)
    },
    [graphData.nodes, nodes],
  )

  const handleNodeMeasure = useCallback((nodeId: string, size: NodeSize) => {
    if (isDraggingNodeRef.current) {
      if (hasMeaningfulSizeChange(pendingMeasuredNodeSizesRef.current, nodeId, size)) {
        pendingMeasuredNodeSizesRef.current.set(nodeId, size)
      }
      return
    }

    if (!hasMeaningfulSizeChange(measuredNodeSizesRef.current, nodeId, size)) {
      return
    }

    measuredNodeSizesRef.current.set(nodeId, size)
    setNodeSizeVersion((version) => version + 1)
  }, [])

  const flushPendingMeasuredNodeSizes = useCallback(() => {
    if (pendingMeasuredNodeSizesRef.current.size === 0) return false

    let changed = false
    for (const [nodeId, size] of pendingMeasuredNodeSizesRef.current) {
      if (hasMeaningfulSizeChange(measuredNodeSizesRef.current, nodeId, size)) {
        measuredNodeSizesRef.current.set(nodeId, size)
        changed = true
      }
    }
    pendingMeasuredNodeSizesRef.current.clear()
    return changed
  }, [])

  const handleNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      if (readonly) return
      draggingNodeIdRef.current = node.id
      isDraggingNodeRef.current = true
      setIsDraggingNode(true)
      lastPreviewFeedbackRef.current = ''
      setPreviewState(null)
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(node.id)
      dispatchGlobalFeedback('drag_start', {
        point: getEventFeedbackPoint(_event),
        origin: 'pointer',
      })
    },
    [onNodeSelect, readonly],
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
          checkOverlap(pending.node.id, pending.node, pending.event)
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
        } else if (activePreview.mode === 'inside' && onReparent) {
          onReparent(node.id, activePreview.targetId)
        }
      }
      const sizeChangedDuringDrag = flushPendingMeasuredNodeSizes()
      const nextLayout =
        activePreview && activePreview.sourceId === node.id
          ? buildPreviewGraph(graphData, activePreview, measuredNodeSizesRef.current)
          : applyMindMapLayout(graphData, measuredNodeSizesRef.current)
      setNodes(nextLayout.nodes)
      setEdges(nextLayout.edges)
      setPreviewState(null)
      isDraggingNodeRef.current = false
      setIsDraggingNode(false)
      draggingNodeIdRef.current = null
      lastPreviewFeedbackRef.current = ''
      if (sizeChangedDuringDrag) {
        setNodeSizeVersion((version) => version + 1)
      }
    },
    [flushPendingMeasuredNodeSizes, graphData, onReorderSibling, onReparent, readonly, setEdges, setNodes],
  )

  const handleFinishEdit = useCallback(
    (nodeId: string, text: string) => {
      if (readonly) return
      onEdit?.(nodeId, text)
    },
    [onEdit, readonly],
  )

  const handleReadonlyNodeDoubleClick = useCallback(
    (nodeId: string) => {
      if (!readonly) return
      setCtxMenu(null)
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(nodeId)
      onNodeContextAction?.(nodeId)
      dispatchGlobalFeedback('context_menu', {
        origin: 'node',
        label: 'DOUBLE_CLICK',
      })
    },
    [onNodeContextAction, onNodeSelect, readonly],
  )

  const handleNodeTouchLongPress = useCallback(
    (nodeId: string, point: { x: number; y: number }) => {
      if (!touchLongPressEnabled) return
      setCtxMenu(null)
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(nodeId)
      onNodeContextAction?.(nodeId)
      dispatchGlobalFeedback('context_menu', {
        point,
        origin: 'node',
      })
    },
    [onNodeContextAction, onNodeSelect, touchLongPressEnabled],
  )

  const currentNodes = readonly && !isDraggingNode ? layouted.nodes : nodes
  const currentEdges = readonly && !isDraggingNode ? layouted.edges : edges

  const displayNodes = useMemo(() => {
    const previewNodesById = new Map(
      (previewLayout?.nodes ?? []).map((node) => [node.id, node]),
    )
    const sourceId = draggingNodeIdRef.current

    return currentNodes.map((node) => {
      const preview =
        previewState && previewState.targetId === node.id ? previewState : null
      const previewNode = previewNodesById.get(node.id)
      const isSource = isDraggingNode && node.id === sourceId
      const shifted = Boolean(
        previewNode &&
          (Math.abs(previewNode.position.x - node.position.x) > 8 ||
            Math.abs(previewNode.position.y - node.position.y) > 8),
      )

      return {
        ...node,
        position: isSource || !previewNode ? node.position : previewNode.position,
        zIndex: isSource ? 100 : preview ? 50 : 1,
        data: {
          ...(node.data as Record<string, unknown>),
          selected: node.id === selectedNodeId,
          dropHighlight: Boolean(preview),
          dropMode: preview?.mode ?? null,
          previewShifted: shifted && !isSource,
          previewAdopt: preview?.mode === 'inside',
          previewGhost: isSource,
          onAddChild,
          onDelete,
          onFinishEdit: handleFinishEdit,
          onMeasure: handleNodeMeasure,
          onReadonlyDoubleClick: handleReadonlyNodeDoubleClick,
          onTouchLongPress: touchLongPressEnabled ? handleNodeTouchLongPress : undefined,
          readonly,
        },
      }
    })
  }, [currentNodes, handleFinishEdit, handleNodeMeasure, handleNodeTouchLongPress, handleReadonlyNodeDoubleClick, isDraggingNode, onAddChild, onDelete, previewLayout, previewState, readonly, selectedNodeId, touchLongPressEnabled])

  const displayEdges = useMemo(() => {
    const baseEdges = previewLayout?.edges ?? currentEdges
    return baseEdges.map((edge) => ({
      ...edge,
      className:
        edge.id === selectedEdgeId
          ? `${edge.className ?? ''} memory-anki-reactflow-edge-selected`.trim()
          : edge.className,
      style: {
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
      },
    }))
  }, [currentEdges, previewLayout, selectedEdgeId])

  useLayoutEffect(() => {
    const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes(nextLayout.nodes)
    setEdges(nextLayout.edges)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
    setPreviewState(null)
    isDraggingNodeRef.current = false
    setIsDraggingNode(false)
  }, [graphData, setEdges, setNodes])

  useLayoutEffect(() => {
    if (nodeSizeVersion === 0 || isDraggingNodeRef.current) return

    const nextLayout = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes(nextLayout.nodes)
    setEdges(nextLayout.edges)
  }, [graphData, nodeSizeVersion, setEdges, setNodes])

  const handleNodeContextMenu = useCallback(
    (event: MouseEvent, node: Node) => {
      event.preventDefault()
      onNodeContextAction?.(node.id)
      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(node.id)
      dispatchGlobalFeedback('context_menu', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'node',
      })
    },
    [onNodeContextAction, onNodeSelect],
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
      if (mobileGuidedActive) {
        centerNodeInCanvas(node.id)
      }
      dispatchGlobalFeedback('node_select', {
        point: { x: event.clientX, y: event.clientY },
        origin: 'node',
      })
    },
    [centerNodeInCanvas, mobileGuidedActive, onNodeActivate, onNodeSelect],
  )

  useEffect(() => {
    if (!mobileGuidedActive || !isCanvasReady || graphData.nodes.length === 0) return
    runFitView(180)
  }, [graphData.nodes.length, isCanvasReady, mobileGuidedActive, runFitView])

  useEffect(() => {
    if (!viewCommand || !isCanvasReady) return
    if (handledViewCommandNonceRef.current === viewCommand.nonce) return
    handledViewCommandNonceRef.current = viewCommand.nonce
    if (viewCommand.type === 'fit') {
      runFitView(220)
      return
    }
    centerNodeInCanvas(viewCommand.nodeId, 220)
  }, [centerNodeInCanvas, isCanvasReady, runFitView, viewCommand])

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

  const nodeActions: ContextMenuAction[] = useMemo(() => {
    if (!ctxMenu) return []
    const nodeId = ctxMenu.nodeId
    if (buildNodeActions) return buildNodeActions(nodeId)
    return [
      {
        label: '添加子知识点 (Tab)',
        icon: Plus,
        onClick: () => {
          if (readonly) return
          dispatchGlobalFeedback('node_create', {
            point: { x: ctxMenu.x, y: ctxMenu.y },
            origin: 'node',
          })
          onAddChild(nodeId)
        },
      },
      {
        label: '添加同级知识点 (Enter)',
        icon: Plus,
        onClick: () => {
          if (readonly) return
          dispatchGlobalFeedback('node_create', {
            point: { x: ctxMenu.x, y: ctxMenu.y },
            origin: 'node',
          })
          onAddSibling(nodeId)
        },
      },
      {
        label: '上移',
        icon: ArrowUp,
        onClick: () => {
          if (readonly) return
          dispatchGlobalFeedback('node_move', {
            point: { x: ctxMenu.x, y: ctxMenu.y },
            origin: 'node',
          })
          onMoveUp?.(nodeId)
        },
        disabled: readonly || (canMoveUp ? !canMoveUp(nodeId) : true),
      },
      {
        label: '下移',
        icon: ArrowDown,
        onClick: () => {
          if (readonly) return
          dispatchGlobalFeedback('node_move', {
            point: { x: ctxMenu.x, y: ctxMenu.y },
            origin: 'node',
          })
          onMoveDown?.(nodeId)
        },
        disabled: readonly || (canMoveDown ? !canMoveDown(nodeId) : true),
      },
      {
        label: '重命名',
        icon: Pencil,
        onClick: () => {
          if (readonly) return
          dispatchGlobalFeedback('node_edit_start', {
            point: { x: ctxMenu.x, y: ctxMenu.y },
            origin: 'node',
          })
        },
        disabled: readonly,
      },
      {
        label: '删除 (Delete)',
        icon: Trash2,
        onClick: () => {
          if (readonly) return
          dispatchGlobalFeedback('node_delete', {
            point: { x: ctxMenu.x, y: ctxMenu.y },
            origin: 'node',
          })
          onDelete(nodeId)
        },
        variant: 'danger' as const,
        disabled: readonly,
      },
    ]
  }, [buildNodeActions, canMoveDown, canMoveUp, ctxMenu, onAddChild, onAddSibling, onDelete, onMoveDown, onMoveUp, readonly])

  const edgeActions: ContextMenuAction[] = useMemo(() => {
    if (!edgeMenu) return []
    return [
      {
        label: '插入知识点',
        icon: BetweenHorizontalStart,
        onClick: () => {
          dispatchGlobalFeedback('node_create', {
            point: { x: edgeMenu.x, y: edgeMenu.y },
            origin: 'edge',
            label: 'CARD',
          })
          handleEdgeInsert(
            edgeMenu.edgeId,
            edgeMenu.sourceId,
            edgeMenu.targetId,
          )
        },
      },
      {
        label: '删除关系',
        icon: Unlink,
        onClick: () => {
          dispatchGlobalFeedback('node_delete', {
            point: { x: edgeMenu.x, y: edgeMenu.y },
            origin: 'edge',
            label: 'EDGE',
          })
          handleEdgeDelete(
            edgeMenu.edgeId,
            edgeMenu.sourceId,
            edgeMenu.targetId,
          )
        },
        variant: 'danger' as const,
      },
    ]
  }, [edgeMenu, handleEdgeDelete, handleEdgeInsert])

  const resetLayout = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'LAYOUT',
    })
    const { nodes: newNodes, edges: newEdges } = applyMindMapLayout(graphData, measuredNodeSizesRef.current)
    setNodes(newNodes)
    setEdges(newEdges)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
    setPreviewState(null)
    isDraggingNodeRef.current = false
    setIsDraggingNode(false)
    const rootId = graphData.nodes.find((node) => node.parentId == null)?.id
    const rootNode = rootId ? newNodes.find((node) => node.id === rootId) : null
    if (rootNode) {
      const size = getResolvedNodeSize(rootNode, undefined, measuredNodeSizesRef.current)
      requestAnimationFrame(() => {
        setCenter(
          rootNode.position.x + size.width / 2,
          rootNode.position.y + size.height / 2,
          {
            duration: 220,
            zoom: mobileGuidedActive ? 1.02 : undefined,
          },
        )
      })
      return
    }
    runFitView()
  }, [graphData, mobileGuidedActive, runFitView, setCenter, setEdges, setNodes])

  const refreshCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'REFRESH',
    })
    measuredNodeSizesRef.current.clear()
    pendingMeasuredNodeSizesRef.current.clear()
    const { nodes: newNodes, edges: newEdges } = applyMindMapLayout(graphData, new Map())
    setNodes(newNodes)
    setEdges(newEdges)
    setCtxMenu(null)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
    setPreviewState(null)
    isDraggingNodeRef.current = false
    setIsDraggingNode(false)
    onHostRefresh?.()
    if (!onHostRefresh) {
      runFitView(0)
    }
  }, [graphData, onHostRefresh, runFitView, setEdges, setNodes])

  const zoomInCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'ZOOM',
    })
    zoomIn({ duration: 180 })
  }, [zoomIn])

  const zoomOutCanvas = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'ZOOM',
    })
    zoomOut({ duration: 180 })
  }, [zoomOut])

  return {
    frameRef,
    ctxMenu,
    edgeMenu,
    canvasSize,
    isCanvasReady,
    displayNodes,
    displayEdges,
    isDraggingNode,
    mobileGuidedActive,
    nodeActions,
    edgeActions,
    canShowHistoryControls: Boolean(onUndo || onRedo),
    canUndo,
    canRedo,
    runFitView,
    zoomInCanvas,
    zoomOutCanvas,
    resetLayout,
    refreshCanvas,
    closeNodeMenu: () => setCtxMenu(null),
    closeEdgeMenu: () => setEdgeMenu(null),
    onNodesChange,
    onEdgesChange,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleEdgeClick,
    handleEdgeDoubleClick,
    handlePaneClick,
  }
}
