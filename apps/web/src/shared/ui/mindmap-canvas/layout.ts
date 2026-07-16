import { Position, type Edge, type Node } from '@xyflow/react'
import type { GraphData, MindMapNode } from './adapter'
import { BRANCH_COLORS } from './branchColors'

const ROOT_X = 52
const ROOT_Y = 280
const ROOT_NODE_MIN_HEIGHT = 40
const BRANCH_NODE_MIN_HEIGHT = 34
const LEAF_NODE_MIN_HEIGHT = 30
const NODE_MAX_VISUAL_CHARACTERS = 20
const ROOT_GAP_X = 48
const CHILD_GAP_X = 30
const ROOT_STACK_GAP = 28
const CHILD_GAP_Y = 18
export const NODE_SAFE_GAP = 18
export const DROP_HIT_PADDING_X = 28
export const DROP_HIT_PADDING_Y = 24
/** Pointer distance outside a card that still counts as a near drop candidate (flow px). */
export const DROP_NEAR_THRESHOLD_PX = 56
/** Extra distance beyond enter threshold before an active preview is cleared (anti-flash). */
export const DROP_LEAVE_EXTRA_PX = 24

export type LayoutRole = 'root' | 'branch' | 'leaf'
export type DropMode = 'before' | 'inside' | 'after'

export interface StructureDropRect {
  x: number
  y: number
  width: number
  height: number
}

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

type LayoutBoundsMap = ReadonlyMap<string, LayoutBounds>

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
  /** When multi-dragging, all top-level source ids (includes sourceId). */
  sourceIds?: readonly string[]
  targetId: string
  mode: DropMode
}

/** Vertical band ratios on the target card for drop mode (relativeY / height). */
export const DROP_MODE_BEFORE_RATIO = 0.2
export const DROP_MODE_AFTER_RATIO = 0.8

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
  minHeight: number
  horizontalChrome: number
  verticalChrome: number
  lineHeight: number
  averageCharWidth: number
  metaHeight: number
} {
  switch (role) {
    case 'root':
      return {
        minHeight: ROOT_NODE_MIN_HEIGHT,
        horizontalChrome: 34,
        verticalChrome: 22,
        lineHeight: 20,
        averageCharWidth: 14,
        metaHeight: 0,
      }
    case 'branch':
      return {
        minHeight: BRANCH_NODE_MIN_HEIGHT,
        horizontalChrome: 26,
        verticalChrome: 18,
        lineHeight: 17,
        averageCharWidth: 13,
        metaHeight: 0,
      }
    default:
      return {
        minHeight: LEAF_NODE_MIN_HEIGHT,
        horizontalChrome: 22,
        verticalChrome: 14,
        lineHeight: 17,
        averageCharWidth: 12.5,
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
  const longestLineLength = label
    .split(/\r?\n/)
    .reduce((longest, line) => Math.max(longest, getWeightedTextLength(line)), 0)
  const naturalWidth = Math.ceil(
    longestLineLength * base.averageCharWidth + base.horizontalChrome,
  )
  const maxWidth = Math.ceil(
    NODE_MAX_VISUAL_CHARACTERS * base.averageCharWidth + base.horizontalChrome,
  )
  const width = Math.min(maxWidth, Math.max(base.horizontalChrome + base.averageCharWidth, naturalWidth))
  const contentWidth = Math.max(width - base.horizontalChrome, base.averageCharWidth)
  const charsPerLine = Math.max(1, Math.floor(contentWidth / base.averageCharWidth))
  const textLineCount = label
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(getWeightedTextLength(line) / charsPerLine)), 0)
  const textHeight = textLineCount * base.lineHeight
  const height = Math.max(
    base.minHeight,
    Math.ceil(base.verticalChrome + textHeight + base.metaHeight),
  )

  return { width, height }
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

function measureTree(
  node: LayoutTreeNode,
  measuredSizes: NodeSizeMap | undefined,
  boundsByNodeId: Map<string, LayoutBounds>,
): LayoutBounds {
  const cached = boundsByNodeId.get(node.node.id)
  if (cached) return cached

  const size = getTreeNodeSize(node, measuredSizes)

  if (node.children.length === 0) {
    const bounds = { width: size.width, height: size.height, subtreeHeight: size.height }
    boundsByNodeId.set(node.node.id, bounds)
    return bounds
  }

  const childBounds = node.children.map((child) => measureTree(child, measuredSizes, boundsByNodeId))
  const childrenHeight =
    childBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    CHILD_GAP_Y * Math.max(0, node.children.length - 1)
  const tallestChildWidth = Math.max(...childBounds.map((bound) => bound.width))
  const subtreeHeight = Math.max(size.height, childrenHeight)
  const gapX = node.depth === 0 ? ROOT_GAP_X : CHILD_GAP_X

  const bounds = {
    width: size.width + gapX + tallestChildWidth,
    height: size.height,
    subtreeHeight,
  }
  boundsByNodeId.set(node.node.id, bounds)
  return bounds
}

function layoutTreeNodes(
  node: LayoutTreeNode,
  x: number,
  top: number,
  positions: Map<string, Node>,
  edgeColors: Map<string, string>,
  boundsByNodeId: LayoutBoundsMap,
  measuredSizes?: NodeSizeMap,
): LayoutBounds {
  const size = getTreeNodeSize(node, measuredSizes)
  const ownBounds = boundsByNodeId.get(node.node.id) ?? {
    width: size.width,
    height: size.height,
    subtreeHeight: size.height,
  }
  const y = top + ownBounds.subtreeHeight / 2 - size.height / 2

  positions.set(node.node.id, {
    id: node.node.id,
    type: 'mindmapNode',
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    position: { x, y },
    // Selection-only drag is applied in buildDisplayNodes (selected && !editing).
    draggable: false,
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

  const childBounds = node.children.map((child) => boundsByNodeId.get(child.node.id) ?? {
    width: getTreeNodeSize(child, measuredSizes).width,
    height: getTreeNodeSize(child, measuredSizes).height,
    subtreeHeight: getTreeNodeSize(child, measuredSizes).height,
  })
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
      boundsByNodeId,
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

function nodesOverlap(
  first: Node,
  second: Node,
  measuredSizes: NodeSizeMap | undefined,
  minGap: number,
): boolean {
  const firstSize = getResolvedNodeSize(first, undefined, measuredSizes)
  const secondSize = getResolvedNodeSize(second, undefined, measuredSizes)
  return !(
    first.position.x + firstSize.width + minGap <= second.position.x ||
    second.position.x + secondSize.width + minGap <= first.position.x ||
    first.position.y + firstSize.height + minGap <= second.position.y ||
    second.position.y + secondSize.height + minGap <= first.position.y
  )
}

function hasNodeOverlaps(
  nodes: Node[],
  measuredSizes: NodeSizeMap | undefined,
  minGap: number,
): boolean {
  const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y)
  const activeNodes: Node[] = []

  for (const node of sortedNodes) {
    const nodeTop = node.position.y
    for (let index = activeNodes.length - 1; index >= 0; index--) {
      const active = activeNodes[index]
      const activeBottom =
        active.position.y + getResolvedNodeSize(active, undefined, measuredSizes).height + minGap
      if (activeBottom <= nodeTop) {
        activeNodes.splice(index, 1)
      }
    }
    if (activeNodes.some((active) => nodesOverlap(active, node, measuredSizes, minGap))) {
      return true
    }
    activeNodes.push(node)
  }
  return false
}

function stackNodesWithoutOverlap(
  nodes: Node[],
  measuredSizes: NodeSizeMap | undefined,
  minGap: number,
): Node[] {
  let currentTop = Math.min(...nodes.map((node) => node.position.y), ROOT_Y)
  return [...nodes]
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .map((node) => {
      const nextNode = {
        ...node,
        position: { x: node.position.x, y: currentTop },
      }
      currentTop += getResolvedNodeSize(node, undefined, measuredSizes).height + minGap
      return nextNode
    })
    .sort((a, b) => nodes.findIndex((node) => node.id === a.id) - nodes.findIndex((node) => node.id === b.id))
}

function resolveOverlaps(
  nodes: Node[],
  measuredSizes?: NodeSizeMap,
  minGap = NODE_SAFE_GAP,
  maxIterations = 8,
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
    const positionedNodes = Array.from(nodeMap.values()).sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
    )
    let anyOverlap = false

    for (let upperIndex = 0; upperIndex < positionedNodes.length; upperIndex++) {
      const upper = nodeMap.get(positionedNodes[upperIndex].id)
      if (!upper) continue
      const upperSize = getResolvedNodeSize(upper, undefined, measuredSizes)
      const upperRight = upper.position.x + upperSize.width
      const upperBottom = upper.position.y + upperSize.height

      for (let lowerIndex = upperIndex + 1; lowerIndex < positionedNodes.length; lowerIndex++) {
        const lower = nodeMap.get(positionedNodes[lowerIndex].id)
        if (!lower) continue
        const lowerSize = getResolvedNodeSize(lower, undefined, measuredSizes)
        if (lower.position.y >= upperBottom + minGap) break

        const lowerRight = lower.position.x + lowerSize.width
        const horizontallySeparated =
          lower.position.x >= upperRight + minGap ||
          upper.position.x >= lowerRight + minGap
        if (horizontallySeparated) continue

        anyOverlap = true
        shiftSubtree(lower.id, upperBottom + minGap - lower.position.y)
      }
    }

    if (!anyOverlap) break
  }

  const resolvedNodes = nodes.map((node) => nodeMap.get(node.id) ?? node)
  return hasNodeOverlaps(resolvedNodes, measuredSizes, minGap)
    ? stackNodesWithoutOverlap(resolvedNodes, measuredSizes, minGap)
    : resolvedNodes
}

export function applyMindMapLayout(
  graphData: GraphData,
  measuredSizes?: NodeSizeMap,
): PositionedGraph {
  const forest = buildLayoutForest(graphData)
  const positions = new Map<string, Node>()
  const edgeColors = new Map<string, string>()
  const boundsByNodeId = new Map<string, LayoutBounds>()
  const rootBounds = forest.map((root) => measureTree(root, measuredSizes, boundsByNodeId))

  const totalHeight =
    rootBounds.reduce((sum, bound) => sum + bound.subtreeHeight, 0) +
    ROOT_STACK_GAP * Math.max(0, forest.length - 1)
  let currentTop = ROOT_Y - totalHeight / 2

  forest.forEach((root, index) => {
    layoutTreeNodes(root, ROOT_X, currentTop, positions, edgeColors, boundsByNodeId, measuredSizes)
    currentTop += rootBounds[index].subtreeHeight + ROOT_STACK_GAP
  })

  const rawNodes = graphData.nodes
    .map((graphNode) => positions.get(graphNode.id))
    .filter((node): node is Node => Boolean(node))
  const nodes = resolveOverlaps(rawNodes, measuredSizes)

  const edges = graphData.edges.map((edge) => {
    const edgeColor = edgeColors.get(edge.id) ?? '#89a89e'
    const runtimeStyle = edge.renderStyle
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'default',
      animated: false,
      interactionWidth: 28,
      sourceHandle: undefined,
      targetHandle: undefined,
      pathOptions: { curvature: 0.32 },
      style: {
        stroke: edge.style === 'dashed' ? '#a0aab3' : runtimeStyle?.stroke ?? edgeColor,
        strokeWidth: edge.style === 'dashed' ? 1.3 : runtimeStyle?.strokeWidth ?? 1.5,
        strokeDasharray: edge.style === 'dashed' ? '4 4' : undefined,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        opacity: 0.92,
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
  const sourceIds = preview.sourceIds?.length
    ? [...preview.sourceIds]
    : [preview.sourceId]
  const target = graphData.nodes.find((node) => node.id === preview.targetId)
  if (!target) return applyMindMapLayout(graphData, measuredSizes)

  let nodes = graphData.nodes
  for (const sourceId of sourceIds) {
    const source = nodes.find((node) => node.id === sourceId)
    if (!source || source.id === target.id) continue
    if (isDescendant(nodes, source.id, target.id)) {
      return applyMindMapLayout(graphData, measuredSizes)
    }
    nodes = movePreviewNode(nodes, sourceId, preview.targetId, preview.mode)
  }
  return applyMindMapLayout({ ...graphData, nodes }, measuredSizes)
}

export function resolveDropMode(relativeY: number, height: number): DropMode {
  if (height <= 0) return 'inside'
  const ratio = relativeY / height
  if (ratio < DROP_MODE_BEFORE_RATIO) return 'before'
  if (ratio > DROP_MODE_AFTER_RATIO) return 'after'
  return 'inside'
}

/**
 * Structure-drag drop mode:
 * - pointer on the card body → always become a child (`inside`)
 * - pointer in the vertical gap above/below a non-root card → sibling before/after
 * - pure horizontal near-miss → no drop intent for that candidate
 * - root only accepts on-card child drops
 */
export function resolveStructureDropMode(
  probeX: number,
  probeY: number,
  rect: StructureDropRect,
  options?: { isRoot?: boolean; nearThresholdPx?: number },
): DropMode | null {
  const { x, y, width, height } = rect
  if (width <= 0 || height <= 0) return null

  const isRoot = Boolean(options?.isRoot)
  const nearThreshold = options?.nearThresholdPx ?? DROP_NEAR_THRESHOLD_PX
  const inside =
    probeX >= x &&
    probeX <= x + width &&
    probeY >= y &&
    probeY <= y + height

  if (inside) return 'inside'

  // Distance from probe to the unpadded card rectangle.
  const left = x
  const right = x + width
  const top = y
  const bottom = y + height
  const dx = probeX < left ? left - probeX : probeX > right ? probeX - right : 0
  const dy = probeY < top ? top - probeY : probeY > bottom ? probeY - bottom : 0
  const edgeDist = Math.hypot(dx, dy)
  if (edgeDist > nearThreshold) return null

  // Root never accepts sibling before/after.
  if (isRoot) return null

  // Pure horizontal near-miss is not a sibling-gap intent.
  if (dy === 0) return null

  // Vertical gap above/below the card.
  if (probeY < top) return 'before'
  if (probeY > bottom) return 'after'
  return null
}

/** Whether the pointer is still close enough to keep an active drop preview (leave hysteresis). */
export function isWithinStructureDropLeaveZone(
  probeX: number,
  probeY: number,
  rect: StructureDropRect,
  mode: DropMode,
  options?: { isRoot?: boolean; nearThresholdPx?: number; leaveExtraPx?: number },
): boolean {
  const nearThreshold = options?.nearThresholdPx ?? DROP_NEAR_THRESHOLD_PX
  const leaveExtra = options?.leaveExtraPx ?? DROP_LEAVE_EXTRA_PX
  const leaveThreshold = nearThreshold + leaveExtra
  const resolved = resolveStructureDropMode(probeX, probeY, rect, {
    isRoot: options?.isRoot,
    nearThresholdPx: leaveThreshold,
  })
  if (!resolved) return false
  // Same semantic family: inside stays inside; before/after may stick to either sibling side
  // only if the leave zone still resolves to the same mode, or still on-card inside for that target.
  if (mode === 'inside') return resolved === 'inside' || resolved === 'before' || resolved === 'after'
  return resolved === mode || resolved === 'inside'
}
