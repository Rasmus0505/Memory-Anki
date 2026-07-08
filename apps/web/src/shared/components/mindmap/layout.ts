import { Position, type Edge, type Node } from '@xyflow/react'
import type { GraphData, MindMapNode } from './adapter'
import { BRANCH_COLORS } from './branchColors'

export const TOOLBAR_HEIGHT = 54
const ROOT_X = 52
const ROOT_Y = 280
const ROOT_NODE_WIDTH = 170
const ROOT_NODE_MIN_HEIGHT = 40
const BRANCH_NODE_WIDTH = 152
const BRANCH_NODE_MIN_HEIGHT = 34
const LEAF_NODE_WIDTH = 136
const LEAF_NODE_MIN_HEIGHT = 30
const ROOT_GAP_X = 48
const CHILD_GAP_X = 30
const ROOT_STACK_GAP = 18
const CHILD_GAP_Y = 12
export const DROP_HIT_PADDING_X = 16
export const DROP_HIT_PADDING_Y = 12

export type LayoutRole = 'root' | 'branch' | 'leaf'
export type DropMode = 'before' | 'inside' | 'after'

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

export interface NodeSize {
  width: number
  height: number
}

export type NodeSizeMap = ReadonlyMap<string, NodeSize>

export interface PositionedGraph {
  nodes: Node[]
  edges: Edge[]
}

export interface PreviewState {
  sourceId: string
  targetId: string
  mode: DropMode
}

type NodeSizeSource =
  | LayoutRole
  | MindMapNode
  | Node
  | {
      label?: unknown
      data?: unknown
      metadata?: Record<string, unknown>
    }
  | undefined

function isLayoutRole(value: unknown): value is LayoutRole {
  return value === 'root' || value === 'branch' || value === 'leaf'
}

function getNodeLabel(source: NodeSizeSource): string {
  if (!source || typeof source === 'string') return ''
  const directLabel = 'label' in source ? source.label : undefined
  if (typeof directLabel === 'string') return directLabel

  const data = 'data' in source ? source.data : undefined
  if (data && typeof data === 'object' && 'label' in data) {
    const dataLabel = (data as { label?: unknown }).label
    return typeof dataLabel === 'string' ? dataLabel : ''
  }

  return ''
}

function getNodeId(source: NodeSizeSource): string | null {
  if (!source || typeof source === 'string') return null
  const directId = 'id' in source ? source.id : undefined
  return typeof directId === 'string' ? directId : null
}

export function getNodeRole(node?: NodeSizeSource): LayoutRole {
  if (isLayoutRole(node)) return node

  const metadata =
    node && typeof node === 'object' && 'data' in node
      ? ((node.data as { metadata?: Record<string, unknown> } | undefined)?.metadata)
      : node && typeof node === 'object' && 'metadata' in node
        ? node.metadata
        : undefined
  const role = metadata?.layoutRole
  return isLayoutRole(role) ? role : 'branch'
}

function getBaseNodeSize(role: LayoutRole): {
  width: number
  minHeight: number
  horizontalPadding: number
  verticalPadding: number
  lineHeight: number
  averageCharWidth: number
  metaHeight: number
} {
  switch (role) {
    case 'root':
      return {
        width: ROOT_NODE_WIDTH,
        minHeight: ROOT_NODE_MIN_HEIGHT,
        horizontalPadding: 24,
        verticalPadding: 12,
        lineHeight: 20,
        averageCharWidth: 14,
        metaHeight: 0,
      }
    case 'branch':
      return {
        width: BRANCH_NODE_WIDTH,
        minHeight: BRANCH_NODE_MIN_HEIGHT,
        horizontalPadding: 14,
        verticalPadding: 10,
        lineHeight: 17,
        averageCharWidth: 13,
        metaHeight: 0,
      }
    default:
      return {
        width: LEAF_NODE_WIDTH,
        minHeight: LEAF_NODE_MIN_HEIGHT,
        horizontalPadding: 14,
        verticalPadding: 9,
        lineHeight: 17,
        averageCharWidth: 12,
        metaHeight: 0,
      }
  }
}

function getWeightedTextLength(text: string): number {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + 0.35
    return sum + (char.charCodeAt(0) > 255 ? 1 : 0.58)
  }, 0)
}

export function getNodeSize(
  source?: NodeSizeSource,
  labelOverride?: string,
): NodeSize {
  const role = getNodeRole(source)
  const base = getBaseNodeSize(role)
  const label = ((labelOverride ?? getNodeLabel(source)) || '').trim() || '未命名节点'
  const contentWidth = Math.max(base.width - base.horizontalPadding, base.averageCharWidth)
  const charsPerLine = Math.max(1, Math.floor(contentWidth / base.averageCharWidth))
  const textLineCount = label
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(getWeightedTextLength(line) / charsPerLine)), 0)
  const textHeight = textLineCount * base.lineHeight
  const height = Math.max(
    base.minHeight,
    Math.ceil(base.verticalPadding + textHeight + base.metaHeight),
  )

  return { width: base.width, height }
}

export function getResolvedNodeSize(
  source?: NodeSizeSource,
  labelOverride?: string,
  measuredSizes?: NodeSizeMap,
): NodeSize {
  const fallback = getNodeSize(source, labelOverride)
  const nodeId = getNodeId(source)
  const measured = nodeId ? measuredSizes?.get(nodeId) : undefined

  if (!measured || measured.width <= 0 || measured.height <= 0) {
    return fallback
  }

  return {
    width: Math.max(fallback.width, Math.ceil(measured.width)),
    height: Math.max(fallback.height, Math.ceil(measured.height)),
  }
}

function getTreeNodeSize(node: LayoutTreeNode, measuredSizes?: NodeSizeMap): NodeSize {
  const measured = measuredSizes?.get(node.node.id)
  const fallback = getNodeSize(node.layoutRole, node.node.label)

  if (!measured || measured.width <= 0 || measured.height <= 0) {
    return fallback
  }

  return {
    width: Math.max(fallback.width, Math.ceil(measured.width)),
    height: Math.max(fallback.height, Math.ceil(measured.height)),
  }
}

export function isDescendant(
  nodes: MindMapNode[],
  sourceId: string,
  targetId: string,
): boolean {
  let current = nodes.find((node) => node.id === targetId)

  while (current?.parentId) {
    if (current.parentId === sourceId) return true
    current = nodes.find((node) => node.id === current?.parentId)
  }

  return false
}

function buildLayoutForest(graphData: GraphData): LayoutTreeNode[] {
  const byParent = new Map<string | null, MindMapNode[]>()

  for (const node of graphData.nodes) {
    const key = node.parentId ?? null
    const current = byParent.get(key) ?? []
    current.push(node)
    byParent.set(key, current)
  }

  const buildNode = (
    node: MindMapNode,
    depth: number,
    inheritedColor: string,
  ): LayoutTreeNode => {
    const rawChildren = byParent.get(node.id) ?? []
    const layoutRole: LayoutRole =
      depth === 0 ? 'root' : rawChildren.length > 0 ? 'branch' : 'leaf'

    return {
      node,
      depth,
      layoutRole,
      branchColor: inheritedColor,
      children: rawChildren.map((child, index) => {
        const nextColor =
          depth === 0
            ? BRANCH_COLORS[index % BRANCH_COLORS.length]
            : inheritedColor
        return buildNode(child, depth + 1, nextColor)
      }),
    }
  }

  const roots = byParent.get(null) ?? []
  return roots.map((root, index) =>
    buildNode(root, 0, BRANCH_COLORS[index % BRANCH_COLORS.length]),
  )
}

function measureTree(node: LayoutTreeNode, measuredSizes?: NodeSizeMap): LayoutBounds {
  const size = getTreeNodeSize(node, measuredSizes)

  if (node.children.length === 0) {
    return { width: size.width, height: size.height, subtreeHeight: size.height }
  }

  const childBounds = node.children.map((child) => measureTree(child, measuredSizes))
  const childrenHeight =
    childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    CHILD_GAP_Y * Math.max(0, node.children.length - 1)
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
  edgeColors: Map<string, string>,
  measuredSizes?: NodeSizeMap,
): LayoutBounds {
  const size = getTreeNodeSize(node, measuredSizes)
  const ownBounds = measureTree(node, measuredSizes)
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

  const childBounds = node.children.map((child) => measureTree(child, measuredSizes))
  const childrenHeight =
    childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    CHILD_GAP_Y * Math.max(0, node.children.length - 1)
  const childrenTop =
    top + (ownBounds.subtreeHeight - childrenHeight) / 2
  const gapX = node.depth === 0 ? ROOT_GAP_X : CHILD_GAP_X
  let currentTop = childrenTop

  node.children.forEach((child, index) => {
    const childBound = childBounds[index]
    layoutTreeNodes(
      child,
      x + size.width + gapX,
      currentTop,
      positions,
      edgeColors,
      measuredSizes,
    )
    edgeColors.set(`${node.node.id}->${child.node.id}`, child.branchColor)
    currentTop += childBound.subtreeHeight + CHILD_GAP_Y
  })

  return ownBounds
}

function getNodeParentId(node: Node): string | null {
  const data = node.data as { parentId?: unknown }
  return typeof data.parentId === 'string' ? data.parentId : null
}

function resolveOverlaps(
  nodes: Node[],
  measuredSizes?: NodeSizeMap,
  minGap = 8,
  maxIterations = 3,
): Node[] {
  const nodeMap = new Map<string, Node>(nodes.map((node) => [node.id, { ...node }]))
  const childrenByParent = new Map<string, string[]>()

  for (const node of nodes) {
    const parentId = getNodeParentId(node)
    if (!parentId) continue
    const children = childrenByParent.get(parentId) ?? []
    children.push(node.id)
    childrenByParent.set(parentId, children)
  }

  const shiftSubtree = (nodeId: string, shift: number) => {
    const stack = [nodeId]
    while (stack.length > 0) {
      const currentId = stack.pop()!
      const current = nodeMap.get(currentId)
      if (!current) continue

      nodeMap.set(currentId, {
        ...current,
        position: {
          x: current.position.x,
          y: current.position.y + shift,
        },
      })

      stack.push(...(childrenByParent.get(currentId) ?? []))
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const byColumn = new Map<number, Node[]>()

    for (const node of nodeMap.values()) {
      const column = Math.round(node.position.x)
      const columnNodes = byColumn.get(column) ?? []
      columnNodes.push(node)
      byColumn.set(column, columnNodes)
    }

    let anyOverlap = false

    for (const columnNodes of byColumn.values()) {
      columnNodes.sort((a, b) => a.position.y - b.position.y)

      for (let index = 0; index < columnNodes.length - 1; index++) {
        const upper = columnNodes[index]
        const lower = columnNodes[index + 1]
        const upperBottom = upper.position.y + getResolvedNodeSize(upper, undefined, measuredSizes).height
        const requiredTop = upperBottom + minGap

        if (lower.position.y >= requiredTop) continue

        anyOverlap = true
        shiftSubtree(lower.id, requiredTop - lower.position.y)
        columnNodes[index + 1] = nodeMap.get(lower.id)!
      }
    }

    if (!anyOverlap) break
  }

  return nodes.map((node) => nodeMap.get(node.id) ?? node)
}

export function applyMindMapLayout(
  graphData: GraphData,
  measuredSizes?: NodeSizeMap,
): PositionedGraph {
  const forest = buildLayoutForest(graphData)
  const positions = new Map<string, Node>()
  const edgeColors = new Map<string, string>()
  const rootBounds = forest.map((root) => measureTree(root, measuredSizes))

  const totalHeight =
    rootBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    ROOT_STACK_GAP * Math.max(0, forest.length - 1)
  let currentTop = ROOT_Y - totalHeight / 2

  forest.forEach((root, index) => {
    layoutTreeNodes(root, ROOT_X, currentTop, positions, edgeColors, measuredSizes)
    currentTop += rootBounds[index].subtreeHeight + ROOT_STACK_GAP
  })

  const rawNodes = graphData.nodes
    .map((graphNode) => positions.get(graphNode.id))
    .filter((node): node is Node => Boolean(node))
  const nodes = resolveOverlaps(rawNodes, measuredSizes)

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
  mode: DropMode,
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

  sourceNode.parentId =
    cloned.find((node) => node.id === targetId)?.parentId ?? null
  cloned.splice(
    mode === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1,
    0,
    sourceNode,
  )
  return cloned
}

export function buildPreviewGraph(
  graphData: GraphData,
  preview: PreviewState,
  measuredSizes?: NodeSizeMap,
): PositionedGraph {
  const source = graphData.nodes.find((node) => node.id === preview.sourceId)
  const target = graphData.nodes.find((node) => node.id === preview.targetId)
  if (!source || !target) return applyMindMapLayout(graphData, measuredSizes)
  if (
    source.id === target.id ||
    isDescendant(graphData.nodes, source.id, target.id)
  ) {
    return applyMindMapLayout(graphData, measuredSizes)
  }

  const nodes = movePreviewNode(
    graphData.nodes,
    preview.sourceId,
    preview.targetId,
    preview.mode,
  )
  return applyMindMapLayout({ ...graphData, nodes }, measuredSizes)
}
