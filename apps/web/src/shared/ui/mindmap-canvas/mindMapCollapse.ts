import type { MindMapNode } from './adapter'

/** Auto-collapse deep branches once a palace exceeds this many nodes. */
export const AUTO_COLLAPSE_MIN_NODES = 36

/**
 * Depth threshold for auto-collapse: nodes at this depth or deeper that still
 * have children start collapsed. Depth 0 = root. With `1`, root + first-level
 * children stay open; deeper branches fold until expanded.
 */
export const AUTO_COLLAPSE_MAX_EXPANDED_DEPTH = 1

export interface CollapseTreeIndex {
  byId: Map<string, MindMapNode>
  childrenByParent: Map<string, string[]>
  depthById: Map<string, number>
}

export function buildCollapseTreeIndex(nodes: readonly MindMapNode[]): CollapseTreeIndex {
  const byId = new Map<string, MindMapNode>()
  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    byId.set(node.id, node)
    if (!node.parentId) continue
    const list = childrenByParent.get(node.parentId) ?? []
    list.push(node.id)
    childrenByParent.set(node.parentId, list)
  }

  const depthById = new Map<string, number>()
  const roots = nodes.filter((node) => node.parentId == null)
  const stack: Array<{ id: string; depth: number }> = roots.map((root) => ({
    id: root.id,
    depth: 0,
  }))
  while (stack.length > 0) {
    const current = stack.pop()!
    depthById.set(current.id, current.depth)
    for (const childId of childrenByParent.get(current.id) ?? []) {
      stack.push({ id: childId, depth: current.depth + 1 })
    }
  }

  return { byId, childrenByParent, depthById }
}

export function countDescendants(
  nodeId: string,
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): number {
  let count = 0
  const stack = [...(childrenByParent.get(nodeId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    count += 1
    stack.push(...(childrenByParent.get(current) ?? []))
  }
  return count
}

/** Nodes whose children should start collapsed for large maps. */
export function computeDefaultCollapsedNodeIds(
  nodes: readonly MindMapNode[],
  options?: {
    minNodes?: number
    maxExpandedDepth?: number
  },
): Set<string> {
  const minNodes = options?.minNodes ?? AUTO_COLLAPSE_MIN_NODES
  const maxExpandedDepth = options?.maxExpandedDepth ?? AUTO_COLLAPSE_MAX_EXPANDED_DEPTH
  if (nodes.length < minNodes) return new Set()

  const { childrenByParent, depthById } = buildCollapseTreeIndex(nodes)
  const collapsed = new Set<string>()
  for (const node of nodes) {
    const children = childrenByParent.get(node.id)
    if (!children?.length) continue
    const depth = depthById.get(node.id) ?? 0
    if (depth >= maxExpandedDepth) collapsed.add(node.id)
  }
  return collapsed
}

/**
 * Keep user collapse choices for surviving nodes; seed defaults for brand-new
 * branch parents when the map is large enough to need auto-collapse.
 *
 * An empty `previous` is a valid expand-all choice — never treat it as
 * "uninitialized". Only `forceDefault: true` re-applies full defaults.
 * Pass `knownNodeIds` (ids from the prior tree) so brand-new deep parents can
 * still auto-collapse after the user expanded everything.
 */
export function reconcileCollapsedNodeIds(
  previous: ReadonlySet<string>,
  nodes: readonly MindMapNode[],
  options?: {
    practiceModeActive?: boolean
    minNodes?: number
    maxExpandedDepth?: number
    forceDefault?: boolean
    /** Node ids present on the previous tree; used to detect brand-new parents. */
    knownNodeIds?: ReadonlySet<string>
  },
): Set<string> {
  if (options?.practiceModeActive) return new Set()

  const minNodes = options?.minNodes ?? AUTO_COLLAPSE_MIN_NODES
  const maxExpandedDepth = options?.maxExpandedDepth ?? AUTO_COLLAPSE_MAX_EXPANDED_DEPTH
  const { childrenByParent, depthById, byId } = buildCollapseTreeIndex(nodes)

  if (options?.forceDefault) {
    return computeDefaultCollapsedNodeIds(nodes, { minNodes, maxExpandedDepth })
  }

  // Preserve collapse choices for surviving branch parents. Empty `previous`
  // (expand-all) stays empty for those parents.
  const next = new Set<string>()
  for (const id of previous) {
    if (!byId.has(id)) continue
    if ((childrenByParent.get(id) ?? []).length === 0) continue
    next.add(id)
  }

  if (nodes.length < minNodes) return next

  const knownNodeIds = options?.knownNodeIds
  for (const node of nodes) {
    if (previous.has(node.id) || next.has(node.id)) continue
    // Already-known nodes keep the user's expand/collapse decision.
    if (knownNodeIds?.has(node.id)) continue
    // Without a known set, empty previous means expand-all: do not re-seed
    // every deep parent (that was the auto-collapse-after-expand-all bug).
    if (!knownNodeIds && previous.size === 0) continue
    const children = childrenByParent.get(node.id)
    if (!children?.length) continue
    const depth = depthById.get(node.id) ?? 0
    if (depth >= maxExpandedDepth) next.add(node.id)
  }

  return next
}

/** Hide every descendant under a collapsed ancestor (not the collapsed node itself). */
export function collectHiddenNodeIds(
  nodes: readonly MindMapNode[],
  collapsedNodeIds: ReadonlySet<string>,
): Set<string> {
  if (collapsedNodeIds.size === 0) return new Set()

  const { childrenByParent } = buildCollapseTreeIndex(nodes)
  const hidden = new Set<string>()
  for (const collapsedId of collapsedNodeIds) {
    const stack = [...(childrenByParent.get(collapsedId) ?? [])]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (hidden.has(current)) continue
      hidden.add(current)
      stack.push(...(childrenByParent.get(current) ?? []))
    }
  }
  return hidden
}

export function isNodeCollapsed(
  nodeId: string,
  collapsedNodeIds: ReadonlySet<string>,
): boolean {
  return collapsedNodeIds.has(nodeId)
}

/**
 * Single-click fold toggle: collapse adds only `nodeId`; expand removes it and
 * re-collapses any direct child that itself has children.
 *
 * Why re-fold children on expand: double-click uses `expandSubtreeCollapsedIds`,
 * which clears descendant folds so the whole branch can open. After that, a
 * plain toggle that only deleted the parent would dump the entire subtree open
 * again on the next expand. Re-collapsing branch children keeps single-click
 * expansion to one level (direct children visible; grandchildren stay folded).
 * Leaves (no children) stay expanded.
 */
export function toggleCollapsedNodeId(
  nodes: readonly MindMapNode[],
  collapsedNodeIds: ReadonlySet<string>,
  nodeId: string,
): Set<string> {
  const next = new Set(collapsedNodeIds)
  if (next.has(nodeId)) {
    // Expanding one level: show direct children, keep grandchildren folded.
    next.delete(nodeId)
    const { childrenByParent, byId } = buildCollapseTreeIndex(nodes)
    if (!byId.has(nodeId)) return next
    for (const childId of childrenByParent.get(nodeId) ?? []) {
      if ((childrenByParent.get(childId) ?? []).length > 0) {
        next.add(childId)
      }
    }
    return next
  }
  next.add(nodeId)
  return next
}


/** Expand every ancestor so `nodeId` becomes visible. */
export function expandAncestorsForNode(
  nodes: readonly MindMapNode[],
  collapsedNodeIds: ReadonlySet<string>,
  nodeId: string,
): Set<string> {
  if (collapsedNodeIds.size === 0) return new Set(collapsedNodeIds)

  const { byId } = buildCollapseTreeIndex(nodes)
  if (!byId.has(nodeId)) return new Set(collapsedNodeIds)

  const next = new Set(collapsedNodeIds)
  let current = byId.get(nodeId) ?? null
  while (current?.parentId) {
    next.delete(current.parentId)
    current = byId.get(current.parentId) ?? null
  }
  return next
}

/** Visible nodes + direct children under a focus node (for fit-branch). */
export function collectBranchNodeIds(
  nodes: readonly MindMapNode[],
  focusNodeId: string | null | undefined,
  collapsedNodeIds: ReadonlySet<string>,
): string[] {
  if (!focusNodeId) return []
  const { childrenByParent, byId } = buildCollapseTreeIndex(nodes)
  if (!byId.has(focusNodeId)) return []

  const hidden = collectHiddenNodeIds(nodes, collapsedNodeIds)
  const ids: string[] = []
  const stack = [focusNodeId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (hidden.has(current) && current !== focusNodeId) continue
    ids.push(current)
    if (collapsedNodeIds.has(current)) continue
    for (const childId of childrenByParent.get(current) ?? []) {
      stack.push(childId)
    }
  }
  return ids
}

/**
 * Expand `rootId` and every descendant: remove them from the collapsed set.
 * Other collapsed branches stay collapsed.
 */
export function expandSubtreeCollapsedIds(
  nodes: readonly MindMapNode[],
  collapsedNodeIds: ReadonlySet<string>,
  rootId: string,
): Set<string> {
  if (!rootId) return new Set(collapsedNodeIds)
  const { childrenByParent, byId } = buildCollapseTreeIndex(nodes)
  if (!byId.has(rootId)) return new Set(collapsedNodeIds)

  const next = new Set(collapsedNodeIds)
  next.delete(rootId)
  const stack = [...(childrenByParent.get(rootId) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    next.delete(current)
    stack.push(...(childrenByParent.get(current) ?? []))
  }
  return next
}
