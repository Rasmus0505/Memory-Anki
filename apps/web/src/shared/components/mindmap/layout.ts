import { Position, type Edge, type Node } from '@xyflow/react'
import type { GraphData, MindMapNode } from './adapter'
import { BRANCH_COLORS } from './branchColors'

export const TOOLBAR_HEIGHT = 54
const ROOT_X = 52
const ROOT_Y = 280
const ROOT_NODE_WIDTH = 174
const ROOT_NODE_MIN_HEIGHT = 54
const BRANCH_NODE_WIDTH = 156
const BRANCH_NODE_MIN_HEIGHT = 52
const LEAF_NODE_WIDTH = 132
const LEAF_NODE_MIN_HEIGHT = 46
const ROOT_GAP_X = 56
const CHILD_GAP_X = 38
const ROOT_STACK_GAP = 18
const CHILD_GAP_Y = 10
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
        horizontalPadding: 32,
        verticalPadding: 16,
        lineHeight: 20,
        averageCharWidth: 15,
        metaHeight: 0,
      }
    case 'branch':
      return {
        width: BRANCH_NODE_WIDTH,
        minHeight: BRANCH_NODE_MIN_HEIGHT,
        horizontalPadding: 16,
        verticalPadding: 12,
        lineHeight: 16,
        averageCharWidth: 13,
        metaHeight: 19,
      }
    default:
      return {
        width: LEAF_NODE_WIDTH,
        minHeight: LEAF_NODE_MIN_HEIGHT,
        horizontalPadding: 16,
        verticalPadding: 12,
        lineHeight: 16,
        averageCharWidth: 12,
        metaHeight: 18,
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
): { width: number; height: number } {
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

function measureTree(node: LayoutTreeNode): LayoutBounds {
  const size = getNodeSize(node.layoutRole, node.node.label)

  if (node.children.length === 0) {
    return { width: size.width, height: size.height, subtreeHeight: size.height }
  }

  const childBounds = node.children.map(measureTree)
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
): LayoutBounds {
  const size = getNodeSize(node.layoutRole, node.node.label)
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
    )
    edgeColors.set(`${node.node.id}->${child.node.id}`, child.branchColor)
    currentTop += childBound.subtreeHeight + CHILD_GAP_Y
  })

  return ownBounds
}

export function applyMindMapLayout(graphData: GraphData): PositionedGraph {
  const forest = buildLayoutForest(graphData)
  const positions = new Map<string, Node>()
  const edgeColors = new Map<string, string>()
  const rootBounds = forest.map(measureTree)

  const totalHeight =
    rootBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    ROOT_STACK_GAP * Math.max(0, forest.length - 1)
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
): PositionedGraph {
  const source = graphData.nodes.find((node) => node.id === preview.sourceId)
  const target = graphData.nodes.find((node) => node.id === preview.targetId)
  if (!source || !target) return applyMindMapLayout(graphData)
  if (
    source.id === target.id ||
    isDescendant(graphData.nodes, source.id, target.id)
  ) {
    return applyMindMapLayout(graphData)
  }

  const nodes = movePreviewNode(
    graphData.nodes,
    preview.sourceId,
    preview.targetId,
    preview.mode,
  )
  return applyMindMapLayout({ ...graphData, nodes })
}
