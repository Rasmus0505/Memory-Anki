import type { MindMapDoc, MindMapDocNode } from '@/shared/api/contracts'
import { insertMindMapSiblingsAfter } from '@/entities/mindmap-document'

export interface AiSplitPreviewNode {
  id: string
  text: string
  note: string
  children: AiSplitPreviewNode[]
}

function cloneDoc(doc: MindMapDoc): MindMapDoc {
  return JSON.parse(JSON.stringify(doc)) as MindMapDoc
}

function readUid(node: MindMapDocNode | null | undefined): string {
  const uid = node?.data?.uid
  return typeof uid === 'string' ? uid.trim() : ''
}

function readText(node: MindMapDocNode | null | undefined): string {
  const text = node?.data?.text
  return typeof text === 'string' ? text : ''
}

function ensureChildren(node: MindMapDocNode): MindMapDocNode[] {
  if (!Array.isArray(node.children)) node.children = []
  return node.children
}

function newPreviewId() {
  return globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Convert API / editor nodes into editable preview tree. */
export function editorNodesToPreviewTree(nodes: unknown): AiSplitPreviewNode[] {
  if (!Array.isArray(nodes)) return []
  return nodes.map((raw) => {
    const node = (raw && typeof raw === 'object' ? raw : {}) as MindMapDocNode & {
      text?: string
      note?: string
    }
    const data = node.data && typeof node.data === 'object' ? node.data : {}
    const text =
      (typeof data.text === 'string' && data.text)
      || (typeof node.text === 'string' && node.text)
      || ''
    const note =
      (typeof data.note === 'string' && data.note)
      || (typeof node.note === 'string' && node.note)
      || ''
    const id =
      (typeof data.uid === 'string' && data.uid.trim())
      || newPreviewId()
    return {
      id,
      text,
      note,
      children: editorNodesToPreviewTree(node.children),
    }
  })
}

/** Preview tree → editor nodes (fresh uids if missing). */
export function previewTreeToEditorNodes(
  nodes: AiSplitPreviewNode[],
  options?: { uidPrefix?: string },
): MindMapDocNode[] {
  const prefix = options?.uidPrefix ?? 'ai-split-applied'
  let counter = 0
  const walk = (list: AiSplitPreviewNode[]): MindMapDocNode[] => {
    const result: MindMapDocNode[] = []
    for (const item of list) {
      const text = item.text.trim()
      if (!text) continue
      counter += 1
      const uid = item.id?.startsWith('ai-split-')
        ? item.id
        : `${prefix}-${counter}-${newPreviewId().slice(0, 8)}`
      result.push({
        data: {
          text,
          note: item.note.trim(),
          uid,
        },
        children: walk(item.children),
      })
    }
    return result
  }
  return walk(nodes)
}

export function countPreviewNodes(nodes: AiSplitPreviewNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countPreviewNodes(node.children), 0)
}

export function updatePreviewNodeText(
  nodes: AiSplitPreviewNode[],
  nodeId: string,
  text: string,
): AiSplitPreviewNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) return { ...node, text }
    return { ...node, children: updatePreviewNodeText(node.children, nodeId, text) }
  })
}

export function updatePreviewNodeNote(
  nodes: AiSplitPreviewNode[],
  nodeId: string,
  note: string,
): AiSplitPreviewNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) return { ...node, note }
    return { ...node, children: updatePreviewNodeNote(node.children, nodeId, note) }
  })
}

export function deletePreviewNode(
  nodes: AiSplitPreviewNode[],
  nodeId: string,
): AiSplitPreviewNode[] {
  return nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => ({ ...node, children: deletePreviewNode(node.children, nodeId) }))
}

export function addPreviewChild(
  nodes: AiSplitPreviewNode[],
  parentId: string | null,
  text = '新卡片',
): AiSplitPreviewNode[] {
  const created: AiSplitPreviewNode = {
    id: newPreviewId(),
    text,
    note: '',
    children: [],
  }
  if (parentId == null) return [...nodes, created]
  return nodes.map((node) => {
    if (node.id === parentId) {
      return { ...node, children: [...node.children, created] }
    }
    return { ...node, children: addPreviewChild(node.children, parentId, text) }
  })
}

function findTargetLocation(
  root: MindMapDocNode,
  targetUid: string,
): { parent: MindMapDocNode; children: MindMapDocNode[]; index: number } | null {
  const stack: MindMapDocNode[] = [root]
  while (stack.length > 0) {
    const parent = stack.pop()!
    const children = ensureChildren(parent)
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (readUid(child) === targetUid) {
        return { parent, children, index }
      }
      stack.push(child)
    }
  }
  return null
}

/**
 * Replace the node at targetUid with replacement nodes (same parent, preserves sibling order).
 * Does not allow replacing the root.
 */
export function applyReplacementAtUid(
  doc: MindMapDoc,
  targetUid: string,
  replacementNodes: MindMapDocNode[],
): MindMapDoc {
  if (!targetUid.trim()) {
    throw new Error('缺少要替换的目标卡片。')
  }
  if (replacementNodes.length === 0) {
    throw new Error('没有可应用的分卡结果。')
  }
  const next = cloneDoc(doc)
  const root = next.root
  if (!root || typeof root !== 'object') {
    throw new Error('脑图文档无效，无法应用分卡。')
  }
  if (readUid(root) === targetUid) {
    throw new Error('不能替换根节点。')
  }
  const location = findTargetLocation(root, targetUid)
  if (!location) {
    throw new Error('未找到原卡片位置，可能脑图已变化，请重新分卡。')
  }
  location.children.splice(location.index, 1, ...replacementNodes)
  return next
}

/**
 * Insert nodes as siblings after the selected node (same parent).
 * Does not delete the source or selected card.
 * Uses the same uid resolution as the canvas (uid / memoryAnkiId).
 */
export function appendSiblingsAfterUid(
  doc: MindMapDoc,
  selectedUid: string,
  nodes: MindMapDocNode[],
): MindMapDoc {
  if (!selectedUid.trim()) {
    throw new Error('请先在脑图上选中一张卡片。')
  }
  if (nodes.length === 0) {
    throw new Error('没有可追加的分卡结果。')
  }
  if (!doc?.root || typeof doc.root !== 'object') {
    throw new Error('脑图文档无效，无法追加分卡结果。')
  }
  // Domain helper: splice into parent.children after selected — never into selected.children.
  return insertMindMapSiblingsAfter(doc, selectedUid, nodes) as MindMapDoc
}

export function findNodeTextByUid(doc: MindMapDoc | null | undefined, uid: string | null | undefined): string {
  if (!doc?.root || !uid) return ''
  const stack: MindMapDocNode[] = [doc.root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (readUid(node) === uid) return readText(node)
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) stack.push(child)
  }
  return ''
}

export function fingerprintEditorDoc(doc: MindMapDoc | null | undefined): string {
  try {
    return JSON.stringify(doc ?? null) ?? 'null'
  } catch {
    return String(Date.now())
  }
}
