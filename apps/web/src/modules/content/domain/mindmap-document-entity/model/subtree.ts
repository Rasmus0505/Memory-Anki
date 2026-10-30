import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
  type MindMapDocumentV1,
  type MindMapNode,
} from './document'

export interface MindMapSubtreeDocument {
  root?: MindMapNode
}

export function buildSubtreeUidMap(document: MindMapSubtreeDocument | null | undefined) {
  const subtreeMap = new Map<string, string[]>()

  const walk = (node: MindMapNode | null | undefined): string[] => {
    if (!node || typeof node !== 'object') return []
    const ownUid = typeof node.data?.uid === 'string' ? node.data.uid : null
    const childUids = (Array.isArray(node.children) ? node.children : []).flatMap(walk)
    const subtreeUids = ownUid ? [ownUid, ...childUids] : childUids
    if (ownUid) subtreeMap.set(ownUid, Array.from(new Set(subtreeUids)))
    return subtreeUids
  }

  walk(document?.root)
  return subtreeMap
}

/** Every uid that disappears when `nodeUid` is deleted together with its branch. */
export function collectMindMapSubtreeUids(
  document: MindMapDocumentInput,
  nodeUid: string,
): string[] {
  const collected: string[] = []
  const walk = (node: MindMapNode, indexPath: number[], inside: boolean) => {
    const uid = getMindMapNodeUid(node, indexPath.join('-') || 'root')
    const within = inside || uid === nodeUid
    if (within && uid) collected.push(uid)
    ;(Array.isArray(node.children) ? node.children : []).forEach((child, index) =>
      walk(child, [...indexPath, index], within),
    )
  }
  walk(normalizeMindMapDocument(document).root, [], false)
  return collected
}

/**
 * The document narrowed to one review unit: its member nodes plus the ancestor
 * spine that reaches them. Sibling branches are removed; the root always stays
 * as the layout anchor.
 *
 * An empty member set — or a set that matches no node, e.g. a stale unit whose
 * membership just changed — returns the whole document. A rating view must
 * never blank its canvas because of a cache race.
 */
export function filterMindMapDocumentToNodeUids(
  documentInput: MindMapDocumentInput,
  nodeUids: readonly string[],
): MindMapDocumentV1 {
  const document = normalizeMindMapDocument(documentInput)
  const keep = new Set(
    nodeUids.map((uid) => String(uid ?? '').trim()).filter(Boolean),
  )
  if (keep.size === 0) return document
  let matched = 0
  const prune = (node: MindMapNode, isRoot: boolean): boolean => {
    const uid = getMindMapNodeUid(node, '')
    const keptChildren: MindMapNode[] = []
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      if (prune(child, false)) keptChildren.push(child)
    }
    node.children = keptChildren
    const isMember = Boolean(uid) && keep.has(uid)
    if (isMember) matched += 1
    return isRoot || isMember || keptChildren.length > 0
  }
  prune(document.root, true)
  return matched === 0 ? normalizeMindMapDocument(documentInput) : document
}

function pathUidsTo(root: MindMapNode | undefined, targetUid: string): string[] | null {
  if (!root) return null
  const own = getMindMapNodeUid(root, 'root')
  if (own === targetUid) return [own]
  const children = Array.isArray(root.children) ? root.children : []
  for (let index = 0; index < children.length; index += 1) {
    const sub = pathUidsTo(children[index], targetUid)
    if (sub) return [own, ...sub]
  }
  return null
}

/** Visible edit scope: palace-root → branch spine plus the branch subtree. */
export type MindMapBranchScope = {
  branchUid: string
  pathUids: string[]
  keepUids: Set<string>
  subtreeUids: Set<string>
}

export function collectMindMapBranchScope(
  document: MindMapDocumentInput,
  branchUid: string,
): MindMapBranchScope | null {
  const target = String(branchUid || '').trim()
  if (!target) return null
  const doc = normalizeMindMapDocument(document)
  const pathUids = pathUidsTo(doc.root, target)
  if (!pathUids) return null
  const subtreeUids = new Set(collectMindMapSubtreeUids(doc, target))
  return {
    branchUid: target,
    pathUids,
    keepUids: new Set([...pathUids, ...subtreeUids]),
    subtreeUids,
  }
}

export function canAddMindMapBranchChild(scope: MindMapBranchScope | null | undefined, uid: string) {
  if (!scope) return true
  return scope.subtreeUids.has(uid)
}

export function canMutateMindMapBranchStructure(
  scope: MindMapBranchScope | null | undefined,
  uid: string,
) {
  if (!scope) return true
  return scope.subtreeUids.has(uid) && uid !== scope.branchUid
}

export function canRelocateMindMapBranchNodes(
  scope: MindMapBranchScope | null | undefined,
  sourceIds: readonly string[],
  targetId: string,
  mode: 'before' | 'inside' | 'after',
) {
  if (!scope) return true
  if (sourceIds.some((uid) => !canMutateMindMapBranchStructure(scope, uid))) return false
  if (!scope.subtreeUids.has(targetId)) return false
  if (targetId === scope.branchUid && mode !== 'inside') return false
  return true
}

/** Remove selected non-root nodes and promote their children in place. */
export function deleteMindMapNodesOnly(
  document: MindMapDocumentInput,
  nodeUids: readonly string[],
) {
  const nextDocument = normalizeMindMapDocument(document)
  const selected = new Set(nodeUids.filter(Boolean))
  selected.delete(getMindMapNodeUid(nextDocument.root, 'root'))

  const promote = (nodes: MindMapNode[]): MindMapNode[] => nodes.flatMap((node) => {
    const children = promote(Array.isArray(node.children) ? node.children : [])
    node.children = children
    return selected.has(getMindMapNodeUid(node, '')) ? children : [node]
  })

  nextDocument.root.children = promote(nextDocument.root.children ?? [])
  return nextDocument
}
