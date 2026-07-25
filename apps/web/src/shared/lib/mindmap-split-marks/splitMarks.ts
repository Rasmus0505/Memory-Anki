/** Permanent split-mark helpers for palace editor / freestyle mark UI. */

export const PERMANENT_MARK_COLORS = [
  { level: 1, border: '#f59e0b', fill: 'rgba(245, 158, 11, 0.18)', label: 'L1' },
  { level: 2, border: '#06b6d4', fill: 'rgba(6, 182, 212, 0.16)', label: 'L2' },
  { level: 3, border: '#a855f7', fill: 'rgba(168, 85, 247, 0.16)', label: 'L3' },
  { level: 4, border: '#f43f5e', fill: 'rgba(244, 63, 94, 0.16)', label: 'L4' },
  { level: 5, border: '#22c55e', fill: 'rgba(34, 197, 94, 0.16)', label: 'L5' },
] as const

export const TEMPORARY_MARK_COLOR = {
  border: '#eab308',
  fill: 'rgba(234, 179, 8, 0.2)',
  label: '临时',
} as const

export type EditorDocNode = {
  data?: Record<string, unknown> | null
  children?: EditorDocNode[] | null
  [key: string]: unknown
}

export type EditorDoc = {
  root?: EditorDocNode | null
  [key: string]: unknown
}

function nodeUid(node: EditorDocNode, fallback: string): string {
  const data = node.data && typeof node.data === 'object' ? node.data : {}
  return String(data.uid || data.memoryAnkiId || fallback).trim()
}

export function collectPermanentMarkUids(doc: EditorDoc | null | undefined): string[] {
  if (!doc?.root) return []
  const result: string[] = []
  const walk = (node: EditorDocNode, fallback: string) => {
    const uid = nodeUid(node, fallback)
    const data = node.data && typeof node.data === 'object' ? node.data : {}
    if (data.permanentSplitMark === true && uid) result.push(uid)
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => {
      if (child && typeof child === 'object') walk(child, `${fallback}-${index}`)
    })
  }
  walk(doc.root, 'root')
  return result
}

/** Build parent map uid -> parentUid from editor doc. */
export function buildEditorParentMap(doc: EditorDoc | null | undefined): Map<string, string | null> {
  const map = new Map<string, string | null>()
  if (!doc?.root) return map
  const walk = (node: EditorDocNode, parent: string | null, fallback: string) => {
    const uid = nodeUid(node, fallback)
    map.set(uid, parent)
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => {
      if (child && typeof child === 'object') walk(child, uid, `${fallback}-${index}`)
    })
  }
  walk(doc.root, null, 'root')
  return map
}

export function derivePermanentMarkLevels(
  markedUids: Iterable<string>,
  parentByUid: Map<string, string | null>,
  rootUid?: string | null,
): Map<string, number> {
  const marked = new Set(
    [...markedUids].filter((uid) => uid && uid !== rootUid && parentByUid.has(uid)),
  )
  const levels = new Map<string, number>()
  for (const uid of marked) {
    let count = 0
    let current = parentByUid.get(uid) ?? null
    while (current) {
      if (marked.has(current)) count += 1
      current = parentByUid.get(current) ?? null
    }
    levels.set(uid, 1 + count)
  }
  return levels
}

export function colorForPermanentLevel(level: number) {
  const idx = Math.max(0, Math.min(PERMANENT_MARK_COLORS.length - 1, level - 1))
  return PERMANENT_MARK_COLORS[idx]
}

/** Toggle permanentSplitMark on a node by uid; returns new doc clone. */
export function togglePermanentMarkInDoc(
  doc: EditorDoc,
  targetUid: string,
): { doc: EditorDoc; marked: boolean } {
  const clone = structuredClone(doc) as EditorDoc
  let marked = false
  let found = false
  const walk = (node: EditorDocNode, fallback: string): boolean => {
    const uid = nodeUid(node, fallback)
    if (uid === targetUid) {
      const data = { ...(node.data && typeof node.data === 'object' ? node.data : {}) }
      const next = data.permanentSplitMark !== true
      if (next) data.permanentSplitMark = true
      else delete data.permanentSplitMark
      node.data = data
      marked = next
      found = true
      return true
    }
    const children = Array.isArray(node.children) ? node.children : []
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      if (child && typeof child === 'object' && walk(child, `${fallback}-${i}`)) return true
    }
    return false
  }
  if (clone.root) walk(clone.root, 'root')
  if (!found) return { doc, marked: false }
  return { doc: clone, marked }
}
