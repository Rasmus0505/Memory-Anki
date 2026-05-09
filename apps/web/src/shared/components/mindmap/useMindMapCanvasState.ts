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
  getNodeRole,
  getNodeSize,
  isDescendant,
  type DropMode,
  type PreviewState,
  TOOLBAR_HEIGHT,
} from './layout'
import type { MindMapCanvasProps } from './MindMapCanvas'

export interface UseMindMapCanvasStateResult {
  frameRef: RefObject<HTMLDivElement | null>
  ctxMenu: { x: number; y: number; nodeId: string } | null
  edgeMenu: { x: number; y: number; edgeId: string; sourceId: string; targetId: string } | null
  canvasSize: { width: number; height: number }
  isCanvasReady: boolean
  displayNodes: Node[]
  displayEdges: Edge[]
  nodeActions: ContextMenuAction[]
  edgeActions: ContextMenuAction[]
  canShowHistoryControls: boolean
  canUndo: boolean
  canRedo: boolean
  runFitView: (duration?: number) => void
  zoomInCanvas: () => void
  zoomOutCanvas: () => void
  resetLayout: () => void
  closeNodeMenu: () => void
  closeEdgeMenu: () => void
  onNodesChange: OnNodesChange<Node>
  onEdgesChange: OnEdgesChange<Edge>
  handleNodeClick: (event: MouseEvent, node: Node) => void
  handleNodeContextMenu: (event: MouseEvent, node: Node) => void
  handleNodeDragStart: (event: unknown, node: Node) => void
  handleNodeDrag: (event: unknown, node: Node) => void
  handleNodeDragStop: (event: unknown, node: Node) => void
  handleEdgeClick: EdgeMouseHandler
  handleEdgeDoubleClick: EdgeMouseHandler
  handlePaneClick: () => void
}

export function useMindMapCanvasState(
  props: MindMapCanvasProps,
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
  } = props

  const layouted = useMemo(() => applyMindMapLayout(graphData), [graphData])
  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges)
  const { fitView, zoomIn, zoomOut } = useReactFlow()

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
  const previewStateRef = useRef<PreviewState | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const frameRef = useRef<HTMLDivElement>(null)
  const isCanvasReady = canvasSize.width > 0 && canvasSize.height > 0

  const previewLayout = useMemo(
    () => (previewState ? buildPreviewGraph(graphData, previewState) : null),
    [graphData, previewState],
  )

  useEffect(() => {
    previewStateRef.current = previewState
  }, [previewState])

  const runFitView = useCallback(
    (duration = 300) => {
      if (!isCanvasReady) return
      requestAnimationFrame(() => {
        fitView({
          duration,
          padding: focusMode ? 0.03 : 0.06,
          includeHiddenNodes: true,
          minZoom: 0.42,
          maxZoom: 1.15,
        })
      })
    },
    [fitView, focusMode, isCanvasReady],
  )

  useLayoutEffect(() => {
    const element = frameRef.current
    if (!element) return

    const updateSize = () => {
      setCanvasSize({
        width: element.clientWidth,
        height: Math.max(element.clientHeight - TOOLBAR_HEIGHT, 0),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const checkOverlap = useCallback(
    (dragId: string, draggedNode?: Node) => {
      const dragNode = nodes.find((node) => node.id === dragId)
      const activeNode = draggedNode ?? dragNode
      if (!activeNode) return

      const activeSize = getNodeSize(getNodeRole(activeNode))
      const cx = activeNode.position.x + activeSize.width / 2
      const cy = activeNode.position.y + activeSize.height / 2
      let closest: { id: string; dist: number; mode: DropMode } | null = null

      for (const node of nodes) {
        if (node.id === dragId) continue
        if (isDescendant(graphData.nodes, dragId, node.id)) continue
        const role = getNodeRole(node)
        const width = getNodeSize(role).width
        const height = getNodeSize(role).height
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

      setPreviewState(
        closest
          ? { sourceId: dragId, targetId: closest.id, mode: closest.mode }
          : null,
      )
    },
    [graphData.nodes, nodes],
  )

  const handleNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      draggingNodeIdRef.current = node.id
      setPreviewState(null)
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(node.id)
    },
    [onNodeSelect],
  )

  const handleNodeDrag = useCallback(
    (_event: unknown, node: Node) => {
      checkOverlap(node.id, node)
    },
    [checkOverlap],
  )

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      const activePreview = previewStateRef.current
      if (activePreview && activePreview.sourceId === node.id) {
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
      const nextLayout =
        activePreview && activePreview.sourceId === node.id
          ? buildPreviewGraph(graphData, activePreview)
          : applyMindMapLayout(graphData)
      setNodes(nextLayout.nodes)
      setEdges(nextLayout.edges)
      setPreviewState(null)
      draggingNodeIdRef.current = null
    },
    [graphData, onReorderSibling, onReparent, setEdges, setNodes],
  )

  const displayNodes = useMemo(() => {
    const previewNodesById = new Map(
      (previewLayout?.nodes ?? []).map((node) => [node.id, node]),
    )
    const sourceId = draggingNodeIdRef.current

    return nodes.map((node) => {
      const preview =
        previewState && previewState.targetId === node.id ? previewState : null
      const previewNode = previewNodesById.get(node.id)
      const isSource = node.id === sourceId
      const shifted = Boolean(
        previewNode &&
          (Math.abs(previewNode.position.x - node.position.x) > 8 ||
            Math.abs(previewNode.position.y - node.position.y) > 8),
      )

      return {
        ...node,
        position: isSource || !previewNode ? node.position : previewNode.position,
        data: {
          ...(node.data as Record<string, unknown>),
          selected: node.id === selectedNodeId,
          dropHighlight: Boolean(preview),
          dropMode: preview?.mode ?? null,
          previewShifted: shifted && !isSource,
          previewAdopt: preview?.mode === 'inside',
          previewGhost: isSource,
          onAddChild: () => onAddChild(node.id),
          onDelete: () => onDelete(node.id),
          onFinishEdit: (_id: string, text: string) => onEdit?.(node.id, text),
        },
      }
    })
  }, [nodes, onAddChild, onDelete, onEdit, previewLayout, previewState, selectedNodeId])

  const displayEdges = useMemo(() => {
    const baseEdges = previewLayout?.edges ?? edges
    return baseEdges.map((edge) => ({
      ...edge,
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
  }, [edges, previewLayout, selectedEdgeId])

  useEffect(() => {
    const nextLayout = applyMindMapLayout(graphData)
    setNodes(nextLayout.nodes)
    setEdges(nextLayout.edges)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
    setPreviewState(null)
  }, [graphData, setEdges, setNodes])

  const handleNodeContextMenu = useCallback(
    (event: MouseEvent, node: Node) => {
      event.preventDefault()
      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onNodeSelect(node.id)
    },
    [onNodeSelect],
  )

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
  }, [onNodeSelect])

  const handleNodeClick = useCallback(
    (_event: MouseEvent, node: Node) => {
      setSelectedEdgeId(null)
      setEdgeMenu(null)
      onNodeSelect(node.id)
    },
    [onNodeSelect],
  )

  const handleEdgeDelete = useCallback(
    (edgeId: string, sourceId: string, targetId: string) => {
      setEdgeMenu(null)
      setSelectedEdgeId(null)
      onEdgeDelete?.(edgeId, sourceId, targetId)
    },
    [onEdgeDelete],
  )

  const handleEdgeInsert = useCallback(
    (edgeId: string, sourceId: string, targetId: string) => {
      setEdgeMenu(null)
      setSelectedEdgeId(null)
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
    },
    [onNodeSelect],
  )

  const handleEdgeDoubleClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.preventDefault()
      event.stopPropagation()
      handleEdgeDelete(edge.id, edge.source, edge.target)
    },
    [handleEdgeDelete],
  )

  const nodeActions: ContextMenuAction[] = useMemo(() => {
    if (!ctxMenu) return []
    const nodeId = ctxMenu.nodeId
    return [
      { label: '添加子节点 (Tab)', icon: Plus, onClick: () => onAddChild(nodeId) },
      { label: '添加同级节点 (Enter)', icon: Plus, onClick: () => onAddSibling(nodeId) },
      {
        label: '上移',
        icon: ArrowUp,
        onClick: () => onMoveUp?.(nodeId),
        disabled: canMoveUp ? !canMoveUp(nodeId) : true,
      },
      {
        label: '下移',
        icon: ArrowDown,
        onClick: () => onMoveDown?.(nodeId),
        disabled: canMoveDown ? !canMoveDown(nodeId) : true,
      },
      { label: '重命名', icon: Pencil, onClick: () => {} },
      {
        label: '删除 (Delete)',
        icon: Trash2,
        onClick: () => onDelete(nodeId),
        variant: 'danger' as const,
      },
    ]
  }, [canMoveDown, canMoveUp, ctxMenu, onAddChild, onAddSibling, onDelete, onMoveDown, onMoveUp])

  const edgeActions: ContextMenuAction[] = useMemo(() => {
    if (!edgeMenu) return []
    return [
      {
        label: '插入卡片',
        icon: BetweenHorizontalStart,
        onClick: () =>
          handleEdgeInsert(
            edgeMenu.edgeId,
            edgeMenu.sourceId,
            edgeMenu.targetId,
          ),
      },
      {
        label: '删除关系',
        icon: Unlink,
        onClick: () =>
          handleEdgeDelete(
            edgeMenu.edgeId,
            edgeMenu.sourceId,
            edgeMenu.targetId,
          ),
        variant: 'danger' as const,
      },
    ]
  }, [edgeMenu, handleEdgeDelete, handleEdgeInsert])

  const resetLayout = useCallback(() => {
    const { nodes: newNodes, edges: newEdges } = applyMindMapLayout(graphData)
    setNodes(newNodes)
    setEdges(newEdges)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
    setPreviewState(null)
    runFitView()
  }, [graphData, runFitView, setEdges, setNodes])

  return {
    frameRef,
    ctxMenu,
    edgeMenu,
    canvasSize,
    isCanvasReady,
    displayNodes,
    displayEdges,
    nodeActions,
    edgeActions,
    canShowHistoryControls: Boolean(onUndo || onRedo),
    canUndo,
    canRedo,
    runFitView,
    zoomInCanvas: () => zoomIn({ duration: 180 }),
    zoomOutCanvas: () => zoomOut({ duration: 180 }),
    resetLayout,
    closeNodeMenu: () => setCtxMenu(null),
    closeEdgeMenu: () => setEdgeMenu(null),
    onNodesChange,
    onEdgesChange,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
    handleEdgeClick,
    handleEdgeDoubleClick,
    handlePaneClick,
  }
}
