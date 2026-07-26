/**
 * Split-mark helpers for freestyle / palace editor.
 *
 * Mark points are freestyle split anchors: nodes the user designates so a palace
 * can be practiced in smaller branches. Temporary and permanent marks share the
 * same topology (same parent/child structure, same auto level derivation from
 * marked ancestors). Only lifecycle differs:
 * - temporary: freestyle session marks stored via temporary-marks API; cleared
 *   after the marked branch is rated successfully (记得/轻松 settlement).
 * - permanent: `permanentSplitMark` flags on editor_doc nodes; persist with the
 *   palace editor and remain until the user removes them.
 *
 * Levels (L1/L2/…) are derived automatically: a marked node's level = 1 + count
 * of marked ancestors. Colors come from PERMANENT_MARK_COLORS by level.
 */

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

export type SplitMarkChipTone = 'warning' | 'info' | 'success' | 'danger' | 'neutral'

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

/**
 * Derive mark levels from marked uids + parent map.
 * Level = 1 + number of marked ancestors (root is never a mark point).
 */
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

/** Alias: levels are topology-only; same for temporary and permanent marks. */
export const deriveSplitMarkLevels = derivePermanentMarkLevels

export function colorForPermanentLevel(level: number) {
  const idx = Math.max(0, Math.min(PERMANENT_MARK_COLORS.length - 1, level - 1))
  return PERMANENT_MARK_COLORS[idx]
}

export function chipToneForMarkLevel(level: number): SplitMarkChipTone {
  if (level === 1) return 'warning'
  if (level === 2) return 'info'
  if (level === 3) return 'success'
  if (level === 4) return 'danger'
  return 'neutral'
}

/** Build L1/L2/… status chips for marked nodes (shared by temp + permanent UI). */
export function buildSplitMarkStatusChips(
  markedUids: Iterable<string>,
  parentByUid: Map<string, string | null>,
  rootUid?: string | null,
): Record<string, Array<{ text: string; tone: SplitMarkChipTone; style: 'filled' }>> {
  const levels = deriveSplitMarkLevels(markedUids, parentByUid, rootUid)
  const chips: Record<string, Array<{ text: string; tone: SplitMarkChipTone; style: 'filled' }>> = {}
  for (const [uid, level] of levels.entries()) {
    const color = colorForPermanentLevel(level)
    chips[uid] = [{ text: color.label, tone: chipToneForMarkLevel(level), style: 'filled' }]
  }
  return chips
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

/** Clear all permanentSplitMark flags; returns new doc clone. */
export function clearPermanentMarksInDoc(doc: EditorDoc): EditorDoc {
  const clone = structuredClone(doc) as EditorDoc
  const walk = (node: EditorDocNode) => {
    if (node.data && typeof node.data === 'object' && node.data.permanentSplitMark === true) {
      const data = { ...node.data }
      delete data.permanentSplitMark
      node.data = data
    }
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child) => {
      if (child && typeof child === 'object') walk(child)
    })
  }
  if (clone.root) walk(clone.root)
  return clone
}

export function collectRootUid(doc: EditorDoc | null | undefined): string | null {
  if (!doc?.root?.data || typeof doc.root.data !== 'object') return null
  const data = doc.root.data as Record<string, unknown>
  return String(data.uid || data.memoryAnkiId || 'root')
}
