import { Position, type Edge, type Node } from '@xyflow/react'
import type { GraphData, MindMapNode } from './adapter'

export const TOOLBAR_HEIGHT = 54
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
export const DROP_HIT_PADDING_X = 16
export const DROP_HIT_PADDING_Y = 12
const BRANCH_COLORS = ['#5f9e90', '#e4c25d', '#d98b63', '#c7d4c0', '#7ca7a1']

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

export function getNodeSize(
  role: LayoutRole,
): { width: number; height: number } {
  switch (role) {
    case 'root':
      return { width: ROOT_NODE_WIDTH, height: ROOT_NODE_HEIGHT }
    case 'branch':
      return { width: BRANCH_NODE_WIDTH, height: BRANCH_NODE_HEIGHT }
    default:
      return { width: LEAF_NODE_WIDTH, height: LEAF_NODE_HEIGHT }
  }
}

export function getNodeRole(node?: Node): LayoutRole {
  const metadata = (
    node?.data as { metadata?: Record<string, unknown> } | undefined
  )?.metadata
  return String(metadata?.layoutRole ?? 'branch') as LayoutRole
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
  const size = getNodeSize(node.layoutRole)

  if (node.children.length === 0) {
    return { width: size.width, height: size.height, subtreeHeight: size.height }
  }

  const childBounds = node.children.map(measureTree)
  const childrenHeight =
    childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    CHILD_GAP_Y * (node.children.length + 1)
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
  const childrenHeight =
    childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    CHILD_GAP_Y * (node.children.length + 1)
  const childrenTop =
    top + (ownBounds.subtreeHeight - childrenHeight) / 2 + CHILD_GAP_Y
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
