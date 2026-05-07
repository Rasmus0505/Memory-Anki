import { useMemo, useCallback, useState, useEffect, useRef, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
  Plus,
  Pencil,
  Trash2,
  Unlink,
  BetweenHorizontalStart,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { nodeTypes } from './NodeCard'
import { NodeContextMenu } from './NodeContextMenu'
import type { ContextMenuAction } from './NodeContextMenu'
import type { GraphData, MindMapNode } from './adapter'

const TOOLBAR_HEIGHT = 54
const ROOT_X = 52
const ROOT_Y = 280
const ROOT_NODE_WIDTH = 174
const ROOT_NODE_HEIGHT = 54
const BRANCH_NODE_WIDTH = 126
const BRANCH_NODE_HEIGHT = 52
const LEAF_NODE_WIDTH = 116
const LEAF_NODE_HEIGHT = 46
const ROOT_GAP_X = 56
const CHILD_GAP_X = 38
const ROOT_STACK_GAP = 18
const CHILD_GAP_Y = 6
const DROP_HIT_PADDING_X = 16
const DROP_HIT_PADDING_Y = 12
const BRANCH_COLORS = ['#5f9e90', '#e4c25d', '#d98b63', '#c7d4c0', '#7ca7a1']

type LayoutRole = 'root' | 'branch' | 'leaf'
type DropMode = 'before' | 'inside' | 'after'

interface LayoutTreeNode {
  node: MindMapNode
  children: LayoutTreeNode[]
  depth: number
  layoutRole: LayoutRole
  branchColor: string
}

interface LayoutBounds {
  width: number
  height: number
  subtreeHeight: number
}

interface PositionedGraph {
  nodes: Node[]
  edges: Edge[]
}

interface PreviewState {
  sourceId: string
  targetId: string
  mode: DropMode
}

function getNodeSize(role: LayoutRole): { width: number; height: number } {
  switch (role) {
    case 'root':
      return { width: ROOT_NODE_WIDTH, height: ROOT_NODE_HEIGHT }
    case 'branch':
      return { width: BRANCH_NODE_WIDTH, height: BRANCH_NODE_HEIGHT }
    default:
      return { width: LEAF_NODE_WIDTH, height: LEAF_NODE_HEIGHT }
  }
}

function getNodeRole(node?: Node): LayoutRole {
  return String((node?.data as any)?.metadata?.layoutRole ?? 'branch') as LayoutRole
}

function isDescendant(nodes: MindMapNode[], sourceId: string, targetId: string): boolean {
  let current = nodes.find((node) => node.id === targetId)

  while (current?.parentId) {
    if (current.parentId === sourceId) return true
    current = nodes.find((node) => node.id === current?.parentId)
  }

  return false
}

function getNodeRect(node: Node) {
  const role = getNodeRole(node)
  const size = getNodeSize(role)
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + size.width,
    bottom: node.position.y + size.height,
    width: size.width,
    height: size.height,
  }
}

function buildLayoutForest(graphData: GraphData): LayoutTreeNode[] {
  const byParent = new Map<string | null, MindMapNode[]>()

  for (const node of graphData.nodes) {
    const key = node.parentId ?? null
    const current = byParent.get(key) ?? []
    current.push(node)
    byParent.set(key, current)
  }

  const buildNode = (node: MindMapNode, depth: number, inheritedColor: string): LayoutTreeNode => {
    const rawChildren = byParent.get(node.id) ?? []
    const layoutRole: LayoutRole = depth === 0 ? 'root' : rawChildren.length > 0 ? 'branch' : 'leaf'

    return {
      node,
      depth,
      layoutRole,
      branchColor: inheritedColor,
      children: rawChildren.map((child, index) => {
        const nextColor = depth === 0 ? BRANCH_COLORS[index % BRANCH_COLORS.length] : inheritedColor
        return buildNode(child, depth + 1, nextColor)
      }),
    }
  }

  const roots = byParent.get(null) ?? []
  return roots.map((root, index) => buildNode(root, 0, BRANCH_COLORS[index % BRANCH_COLORS.length]))
}

function measureTree(node: LayoutTreeNode): LayoutBounds {
  const size = getNodeSize(node.layoutRole)

  if (node.children.length === 0) {
    return { width: size.width, height: size.height, subtreeHeight: size.height }
  }

  const childBounds = node.children.map(measureTree)
  const childrenHeight = childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) + CHILD_GAP_Y * (node.children.length + 1)
  const tallestChildWidth = Math.max(...childBounds.map((bound) => bound.width))
  const subtreeHeight = Math.max(size.height, childrenHeight)
  const gapX = node.depth === 0 ? ROOT_GAP_X : CHILD_GAP_X

  return {
    width: size.width + gapX + tallestChildWidth,
    height: size.height,
    subtreeHeight,
  }
}

function layoutTreeNodes(
  node: LayoutTreeNode,
  x: number,
  top: number,
  positions: Map<string, Node>,
  edgeColors: Map<string, string>
): LayoutBounds {
  const size = getNodeSize(node.layoutRole)
  const ownBounds = measureTree(node)
  const y = top + ownBounds.subtreeHeight / 2 - size.height / 2

  positions.set(node.node.id, {
    id: node.node.id,
    type: 'mindmapNode',
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    position: { x, y },
    draggable: true,
    data: {
      ...node.node,
      metadata: {
        ...node.node.metadata,
        depth: node.depth,
        branchColor: node.branchColor,
        layoutRole: node.layoutRole,
      },
    },
  })

  if (node.children.length === 0) return ownBounds

  const childBounds = node.children.map(measureTree)
  const childrenHeight = childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) + CHILD_GAP_Y * (node.children.length + 1)
  const childrenTop = top + (ownBounds.subtreeHeight - childrenHeight) / 2 + CHILD_GAP_Y
  const gapX = node.depth === 0 ? ROOT_GAP_X : CHILD_GAP_X
  let currentTop = childrenTop

  node.children.forEach((child, index) => {
    const childBound = childBounds[index]
    layoutTreeNodes(child, x + size.width + gapX, currentTop, positions, edgeColors)
    edgeColors.set(`${node.node.id}->${child.node.id}`, child.branchColor)
    currentTop += childBound.subtreeHeight + CHILD_GAP_Y
  })

  return ownBounds
}

function applyMindMapLayout(graphData: GraphData): PositionedGraph {
  const forest = buildLayoutForest(graphData)
  const positions = new Map<string, Node>()
  const edgeColors = new Map<string, string>()
  const rootBounds = forest.map(measureTree)

  const totalHeight = rootBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) + ROOT_STACK_GAP * Math.max(0, forest.length - 1)
  let currentTop = ROOT_Y - totalHeight / 2

  forest.forEach((root, index) => {
    layoutTreeNodes(root, ROOT_X, currentTop, positions, edgeColors)
    currentTop += rootBounds[index].subtreeHeight + ROOT_STACK_GAP
  })

  const nodes = graphData.nodes
    .map((graphNode) => positions.get(graphNode.id))
    .filter((node): node is Node => Boolean(node))

  const edges = graphData.edges.map((edge) => {
    const edgeColor = edgeColors.get(edge.id) ?? '#89a89e'
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: false,
      interactionWidth: 28,
      sourceHandle: undefined,
      targetHandle: undefined,
      pathOptions: { offset: 10, borderRadius: 8 },
      style: {
        stroke: edge.style === 'dashed' ? '#a0aab3' : edgeColor,
        strokeWidth: edge.style === 'dashed' ? 1.3 : 1.5,
        strokeDasharray: edge.style === 'dashed' ? '4 4' : undefined,
        opacity: 0.94,
      },
      label: edge.label,
    } as Edge
  })

  return { nodes, edges }
}

function cloneTreeNodes(nodes: MindMapNode[]): MindMapNode[] {
  return structuredClone(nodes)
}

function movePreviewNode(
  nodes: MindMapNode[],
  sourceId: string,
  targetId: string,
  mode: DropMode
): MindMapNode[] {
  const cloned = cloneTreeNodes(nodes)
  const sourceIndex = cloned.findIndex((node) => node.id === sourceId)
  const targetIndex = cloned.findIndex((node) => node.id === targetId)
  if (sourceIndex === -1 || targetIndex === -1) return cloned

  const [sourceNode] = cloned.splice(sourceIndex, 1)
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex

  if (mode === 'inside') {
    sourceNode.parentId = targetId
    cloned.splice(adjustedTargetIndex + 1, 0, sourceNode)
    return cloned
  }

  sourceNode.parentId = cloned.find((node) => node.id === targetId)?.parentId ?? null
  cloned.splice(mode === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1, 0, sourceNode)
  return cloned
}

function buildPreviewGraph(graphData: GraphData, preview: PreviewState): PositionedGraph {
  const source = graphData.nodes.find((node) => node.id === preview.sourceId)
  const target = graphData.nodes.find((node) => node.id === preview.targetId)
  if (!source || !target) return applyMindMapLayout(graphData)
  if (source.id === target.id || isDescendant(graphData.nodes, source.id, target.id)) {
    return applyMindMapLayout(graphData)
  }

  const nodes = movePreviewNode(graphData.nodes, preview.sourceId, preview.targetId, preview.mode)
  return applyMindMapLayout({ ...graphData, nodes })
}

export interface MindMapCanvasProps {
  graphData: GraphData
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string | null) => void
  onAddChild: (parentId: string) => void
  onAddSibling: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onReparent?: (sourceId: string, targetId: string) => void
  onEdit?: (nodeId: string, text: string) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  focusMode?: boolean
  onToggleFocusMode?: () => void
  onEdgeDelete?: (edgeId: string, sourceId: string, targetId: string) => void
  onEdgeInsert?: (edgeId: string, sourceId: string, targetId: string) => void
  onReorderSibling?: (sourceId: string, targetId: string, position: 'before' | 'after') => void
  onMoveUp?: (nodeId: string) => void
  onMoveDown?: (nodeId: string) => void
  canMoveUp?: (nodeId: string) => boolean
  canMoveDown?: (nodeId: string) => boolean
  className?: string
}

function MindMapCanvasInner({
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
  onToggleFocusMode,
  onEdgeDelete,
  onEdgeInsert,
  onReorderSibling,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  className,
}: MindMapCanvasProps) {
  const layouted = useMemo(() => applyMindMapLayout(graphData), [graphData])
  const [nodes, setNodes, onNodesChange] = useNodesState(layouted.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layouted.edges)
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string; sourceId: string; targetId: string } | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const previewStateRef = useRef<PreviewState | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const frameRef = useRef<HTMLDivElement>(null)
  const isCanvasReady = canvasSize.width > 0 && canvasSize.height > 0

  const previewLayout = useMemo(
    () => (previewState ? buildPreviewGraph(graphData, previewState) : null),
    [graphData, previewState]
  )

  useEffect(() => {
    previewStateRef.current = previewState
  }, [previewState])

  const runFitView = useCallback((duration = 300) => {
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
  }, [fitView, focusMode, isCanvasReady])

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return

    const updateSize = () => {
      setCanvasSize({
        width: el.clientWidth,
        height: Math.max(el.clientHeight - TOOLBAR_HEIGHT, 0),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const checkOverlap = useCallback((dragId: string, draggedNode?: Node) => {
    const dragNode = nodes.find((n) => n.id === dragId)
    const activeNode = draggedNode ?? dragNode
    if (!activeNode) return

    const activeSize = getNodeSize(getNodeRole(activeNode))
    const cx = activeNode.position.x + activeSize.width / 2
    const cy = activeNode.position.y + activeSize.height / 2
    let closest: { id: string; dist: number; mode: DropMode } | null = null

    for (const n of nodes) {
      if (n.id === dragId) continue
      if (isDescendant(graphData.nodes, dragId, n.id)) continue
      const role = getNodeRole(n)
      const width = getNodeSize(role).width
      const height = getNodeSize(role).height
      const nx = n.position.x + width / 2
      const ny = n.position.y + height / 2
      const dist = Math.sqrt((cx - nx) ** 2 + (cy - ny) ** 2)
      const withinX = cx >= n.position.x - DROP_HIT_PADDING_X && cx <= n.position.x + width + DROP_HIT_PADDING_X
      const withinY = cy >= n.position.y - DROP_HIT_PADDING_Y && cy <= n.position.y + height + DROP_HIT_PADDING_Y
      if ((withinX && withinY) || dist < Math.max(width, 96)) {
        const relativeY = cy - n.position.y
        const mode = relativeY < height * 0.28 ? 'before' : relativeY > height * 0.72 ? 'after' : 'inside'
        if (!closest || dist < closest.dist) closest = { id: n.id, dist, mode }
      }
    }

    setPreviewState(closest ? { sourceId: dragId, targetId: closest.id, mode: closest.mode } : null)
  }, [graphData.nodes, nodes])

  const handleNodeDragStart = useCallback((_e: unknown, node: Node) => {
    draggingNodeIdRef.current = node.id
    setPreviewState(null)
    setEdgeMenu(null)
    setSelectedEdgeId(null)
    onNodeSelect(node.id)
  }, [onNodeSelect])

  const handleNodeDrag = useCallback((_e: unknown, node: Node) => {
    checkOverlap(node.id, node)
  }, [checkOverlap])

  const handleNodeDragStop = useCallback((_e: unknown, node: Node) => {
    const activePreview = previewStateRef.current
    if (activePreview && activePreview.sourceId === node.id) {
      if ((activePreview.mode === 'before' || activePreview.mode === 'after') && onReorderSibling) {
        onReorderSibling(node.id, activePreview.targetId, activePreview.mode)
      } else if (activePreview.mode === 'inside' && onReparent) {
        onReparent(node.id, activePreview.targetId)
      }
    }
    const nextLayout = activePreview && activePreview.sourceId === node.id
      ? buildPreviewGraph(graphData, activePreview)
      : applyMindMapLayout(graphData)
    setNodes(nextLayout.nodes)
    setEdges(nextLayout.edges)
    setPreviewState(null)
    draggingNodeIdRef.current = null
  }, [graphData, onReorderSibling, onReparent, setEdges, setNodes])

  const displayNodes = useMemo(() => {
    const previewNodesById = new Map((previewLayout?.nodes ?? []).map((node) => [node.id, node]))
    const sourceId = draggingNodeIdRef.current

    return nodes.map((node) => {
      const preview = previewState && previewState.targetId === node.id ? previewState : null
      const previewNode = previewNodesById.get(node.id)
      const isSource = node.id === sourceId
      const shifted = Boolean(previewNode && (Math.abs(previewNode.position.x - node.position.x) > 8 || Math.abs(previewNode.position.y - node.position.y) > 8))

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
        stroke: edge.id === selectedEdgeId ? '#4f6d67' : edge.style?.stroke ?? '#89a89e',
        strokeWidth: edge.id === selectedEdgeId ? 2.3 : edge.style?.strokeWidth ?? 1.5,
        opacity: edge.id === selectedEdgeId ? 1 : edge.style?.opacity ?? 0.94,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData])

  const handleNodeContextMenu = useCallback((event: { preventDefault: () => void; clientX: number; clientY: number }, node: Node) => {
    event.preventDefault()
    setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
    setEdgeMenu(null)
    setSelectedEdgeId(null)
    onNodeSelect(node.id)
  }, [onNodeSelect])

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null)
    setSelectedEdgeId(null)
    setEdgeMenu(null)
  }, [onNodeSelect])

  const handleNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    setSelectedEdgeId(null)
    setEdgeMenu(null)
    onNodeSelect(node.id)
  }, [onNodeSelect])

  const handleEdgeDelete = useCallback((edgeId: string, sourceId: string, targetId: string) => {
    setEdgeMenu(null)
    setSelectedEdgeId(null)
    onEdgeDelete?.(edgeId, sourceId, targetId)
  }, [onEdgeDelete])

  const handleEdgeInsert = useCallback((edgeId: string, sourceId: string, targetId: string) => {
    setEdgeMenu(null)
    setSelectedEdgeId(null)
    onEdgeInsert?.(edgeId, sourceId, targetId)
  }, [onEdgeInsert])

  const handleEdgeClick = useCallback<EdgeMouseHandler>((event, edge) => {
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
  }, [onNodeSelect])

  const handleEdgeDoubleClick = useCallback<EdgeMouseHandler>((event, edge) => {
    event.preventDefault()
    event.stopPropagation()
    handleEdgeDelete(edge.id, edge.source, edge.target)
  }, [handleEdgeDelete])

  const nodeActions: ContextMenuAction[] = useMemo(() => {
    if (!ctxMenu) return []
    const nid = ctxMenu.nodeId
    return [
      { label: '添加子节点 (Tab)', icon: Plus, onClick: () => onAddChild(nid) },
      { label: '添加同级节点 (Enter)', icon: Plus, onClick: () => onAddSibling(nid) },
      { label: '上移', icon: ArrowUp, onClick: () => onMoveUp?.(nid), disabled: canMoveUp ? !canMoveUp(nid) : true },
      { label: '下移', icon: ArrowDown, onClick: () => onMoveDown?.(nid), disabled: canMoveDown ? !canMoveDown(nid) : true },
      { label: '重命名', icon: Pencil, onClick: () => {} },
      { label: '删除 (Delete)', icon: Trash2, onClick: () => onDelete(nid), variant: 'danger' as const },
    ]
  }, [canMoveDown, canMoveUp, ctxMenu, onAddChild, onAddSibling, onDelete, onMoveDown, onMoveUp])

  const edgeActions: ContextMenuAction[] = useMemo(() => {
    if (!edgeMenu) return []
    return [
      {
        label: '插入卡片',
        icon: BetweenHorizontalStart,
        onClick: () => handleEdgeInsert(edgeMenu.edgeId, edgeMenu.sourceId, edgeMenu.targetId),
      },
      {
        label: '删除关系',
        icon: Unlink,
        onClick: () => handleEdgeDelete(edgeMenu.edgeId, edgeMenu.sourceId, edgeMenu.targetId),
        variant: 'danger' as const,
      },
    ]
  }, [edgeMenu, handleEdgeDelete, handleEdgeInsert])

  return (
    <div
      ref={frameRef}
      className={`relative flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_16px_48px_rgba(15,23,42,0.06)] ${className ?? ''}`}
    >
      <div className="flex h-[54px] shrink-0 flex-wrap items-center gap-1 border-b border-slate-200/80 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => {
            const { nodes: newNodes, edges: newEdges } = applyMindMapLayout(graphData)
            setNodes(newNodes)
            setEdges(newEdges)
            setSelectedEdgeId(null)
            setEdgeMenu(null)
            setPreviewState(null)
            runFitView()
          }}
          className="flex h-9 items-center justify-center gap-2 rounded-xl border border-transparent px-3 text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
          title="手动整理画布"
        >
          <RotateCcw className="h-4 w-4" />
          <span className="text-xs font-medium">整理画布</span>
        </button>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" onClick={() => zoomOut({ duration: 180 })} className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900" title="缩小">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => zoomIn({ duration: 180 })} className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900" title="放大">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleFocusMode}
          className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${focusMode ? 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100' : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'}`}
          title={focusMode ? '退出画布专注模式' : '进入画布专注模式'}
        >
          {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        {(onUndo || onRedo) ? <div className="mx-1 h-5 w-px bg-slate-200" /> : null}
        {onUndo ? (
          <button type="button" onClick={onUndo} disabled={!canUndo} className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30" title="撤销">
            <Undo2 className="h-4 w-4" />
          </button>
        ) : null}
        {onRedo ? (
          <button type="button" onClick={onRedo} disabled={!canRedo} className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30" title="重做">
            <Redo2 className="h-4 w-4" />
          </button>
        ) : null}
        <div className="ml-auto text-[11px] font-medium tracking-wide text-slate-500">拖拽时会即时预演落点，只有点击“整理画布”才会全局重排</div>
      </div>

      <div className="min-h-0 flex-1">
        {isCanvasReady ? (
          <div className="relative" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onNodeDragStart={handleNodeDragStart}
              onNodeDrag={handleNodeDrag}
              onNodeDragStop={handleNodeDragStop}
              onEdgeClick={handleEdgeClick}
              onEdgeDoubleClick={handleEdgeDoubleClick}
              onPaneClick={handlePaneClick}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              nodeTypes={nodeTypes}
              defaultViewport={{ x: 4, y: 18, zoom: 0.99 }}
              minZoom={0.38}
              maxZoom={1.4}
              proOptions={{ hideAttribution: true }}
            >
              <Controls showZoom={false} showInteractive={false} className="!left-4 !top-4 !bottom-auto !border !border-slate-200/80 !bg-white/92 !shadow-lg" />
              <MiniMap
                pannable
                zoomable
                nodeStrokeWidth={2.5}
                nodeColor={(node) => {
                  const d = node.data as { metadata?: { branchColor?: string; layoutRole?: LayoutRole } }
                  if (d?.metadata?.layoutRole === 'root') return '#c97859'
                  return d?.metadata?.branchColor ?? '#89a89e'
                }}
                className="!bottom-4 !right-4 !h-[116px] !w-[190px] !overflow-hidden !rounded-2xl !border !border-slate-200/80 !bg-white/92 !shadow-lg"
              />
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#edf1ef" />
            </ReactFlow>
          </div>
        ) : (
          <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-muted-foreground">
            正在准备画布...
          </div>
        )}
      </div>

      {ctxMenu ? (
        <NodeContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} actions={nodeActions} />
      ) : null}
      {edgeMenu ? (
        <NodeContextMenu x={edgeMenu.x} y={edgeMenu.y} onClose={() => setEdgeMenu(null)} actions={edgeActions} />
      ) : null}
    </div>
  )
}

export function MindMapCanvas(props: MindMapCanvasProps) {
  return (
    <ReactFlowProvider>
      <MindMapCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
