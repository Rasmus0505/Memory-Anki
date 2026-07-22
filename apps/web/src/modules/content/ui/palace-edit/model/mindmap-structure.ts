import type { MindMapDoc, MindMapDocNode } from '@/shared/api/contracts'

function cloneDoc<T>(value: T): T {
  return structuredClone(value)
}

function getNodeUid(node: MindMapDocNode | null | undefined): string | null {
  if (!node || typeof node !== 'object') return null
  const uid = node.data && typeof node.data === 'object' ? node.data.uid : null
  return typeof uid === 'string' && uid ? uid : null
}

function createNodeUid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function insertIntermediateNodeByEdge(
  doc: MindMapDoc | null,
  sourceUid: string,
  targetUid: string,
): { nextDoc: MindMapDoc | null; insertedUid: string | null } {
  if (!doc?.root || !sourceUid || !targetUid) {
    return { nextDoc: doc, insertedUid: null }
  }

  const nextDoc = cloneDoc(doc)
  let insertedUid: string | null = null

  const walk = (node: MindMapDocNode): boolean => {
    if (getNodeUid(node) !== sourceUid) {
      const children = Array.isArray(node.children) ? node.children : []
      for (const child of children) {
        if (walk(child)) return true
      }
      return false
    }

    const children = Array.isArray(node.children) ? node.children : []
    const targetIndex = children.findIndex((child) => getNodeUid(child) === targetUid)
    if (targetIndex < 0) return false

    const targetNode = children[targetIndex]
    insertedUid = createNodeUid()
    const insertedNode: MindMapDocNode = {
      data: {
        text: '新节点',
        uid: insertedUid,
      },
      children: [targetNode],
    }
    children[targetIndex] = insertedNode
    node.children = children
    return true
  }

  walk(nextDoc.root)
  if (!insertedUid) {
    return { nextDoc: doc, insertedUid: null }
  }
  return { nextDoc, insertedUid }
}
