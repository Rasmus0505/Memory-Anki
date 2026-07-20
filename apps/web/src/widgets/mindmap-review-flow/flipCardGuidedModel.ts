import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/features/mindmap-editor'
import { normalizeMindMapDocument as normalizeEditorDocTree } from '@/entities/mindmap-document'

export interface GuidedMindMapNode {
  uid: string
  text: string
  parentUid: string | null
}

function getGuidedNodeText(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  return (
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim() || fallback
  )
}

export function buildGuidedMindMapModel(editorState: MindMapEditorState) {
  const doc = normalizeEditorDocTree(editorState.editor_doc)
  const nodes: GuidedMindMapNode[] = []
  const byUid = new Map<string, GuidedMindMapNode>()

  const walk = (
    node: NonNullable<ReturnType<typeof normalizeEditorDocTree>['root']>,
    parentUid: string | null,
    indexPath: number[],
  ) => {
    const data = node.data ?? {}
    // Align with canvas / backend node identity (uid → memoryAnkiId → path).
    // Mismatch here makes in-round nodes look out-of-scope (muted) in rating mode.
    const uid = String(data.uid ?? data.memoryAnkiId ?? (indexPath.join('-') || 'root'))
    const fallback = indexPath.length === 0 ? '未命名导图' : '未命名知识点'
    const guidedNode = {
      uid,
      text: getGuidedNodeText(data.text, fallback),
      parentUid,
    }
    nodes.push(guidedNode)
    byUid.set(uid, guidedNode)
    ;(node.children ?? []).forEach((child, index) => {
      walk(child, uid, [...indexPath, index])
    })
  }

  if (doc.root) {
    walk(doc.root, null, [])
  }

  const rootUid = nodes[0]?.uid ?? null
  return { nodes, byUid, rootUid }
}

export function getGuidedPath(
  byUid: Map<string, GuidedMindMapNode>,
  nodeUid: string | null,
) {
  const path: GuidedMindMapNode[] = []
  let current = nodeUid ? byUid.get(nodeUid) ?? null : null
  while (current) {
    path.unshift(current)
    current = current.parentUid ? byUid.get(current.parentUid) ?? null : null
  }
  return path
}

export function toGuidedSelection(node: GuidedMindMapNode): MindMapSelection {
  return {
    uid: node.uid,
    text: node.text,
    note: '',
    memoryAnkiId: null,
    memoryAnkiNodeType: null,
    rawData: {},
  }
}

export function collectSubtreeUids(
  nodes: GuidedMindMapNode[],
  nodeUid: string,
  rootUid: string | null,
) {
  const descendants = new Set<string>([nodeUid])
  let changed = true
  while (changed) {
    changed = false
    nodes.forEach((node) => {
      if (node.parentUid && descendants.has(node.parentUid) && !descendants.has(node.uid)) {
        descendants.add(node.uid)
        changed = true
      }
    })
  }
  return [...descendants].filter((uid) => uid !== rootUid)
}
