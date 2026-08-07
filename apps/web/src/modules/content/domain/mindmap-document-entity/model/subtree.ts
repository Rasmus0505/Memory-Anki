import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
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
