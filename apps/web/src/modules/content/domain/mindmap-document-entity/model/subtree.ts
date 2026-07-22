import type { MindMapNode } from './document'

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
