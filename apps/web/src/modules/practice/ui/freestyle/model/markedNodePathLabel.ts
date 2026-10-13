/**
 * Round-sheet path: root node through the marked anchor.
 * Queue payloads carry `context_path` on each card, which is the preferred source.
 * When a payload has no path, the sheet resolves it from a palace editor document
 * that is already loaded.
 */

type DocNode = {
  data?: { uid?: unknown; text?: unknown; memoryAnkiId?: unknown } | null
  children?: DocNode[] | null
}

export interface MarkedNodePathParts {
  /** First node of the path. Null when the path has only one node. */
  root: string | null
  /** The marked node (last node of the path). Empty when there is no path. */
  anchor: string
  /** Every node of the path, root first, joined by "-" for titles. */
  full: string
}

function plainText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function nodeUid(node: DocNode, fallback: string) {
  const data = node.data && typeof node.data === 'object' ? node.data : {}
  return String(data.uid || data.memoryAnkiId || fallback).trim()
}

function asRoot(doc: unknown): DocNode | null {
  if (doc == null) return null
  let value = doc
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const root = (value as { root?: DocNode }).root
  return root && typeof root === 'object' ? root : null
}

/** Text of each node from the document root through the anchor. Empty when the anchor is missing. */
export function markedNodePathTexts(doc: unknown, anchorUid: string | null | undefined): string[] {
  const anchor = String(anchorUid || '').trim()
  const root = asRoot(doc)
  if (!anchor || !root) return []
  const texts = new Map<string, string>()
  const parents = new Map<string, string | null>()
  const walk = (node: DocNode, parent: string | null, fallback: string) => {
    const uid = nodeUid(node, fallback)
    if (!uid || texts.has(uid)) return
    texts.set(uid, plainText(node.data?.text))
    parents.set(uid, parent)
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, index) => {
      if (child && typeof child === 'object') walk(child, uid, `${fallback}-${index}`)
    })
  }
  walk(root, null, 'root')
  if (!texts.has(anchor)) return []
  const parts: string[] = []
  let current: string | null = anchor
  const seen = new Set<string>()
  while (current && texts.has(current) && !seen.has(current)) {
    seen.add(current)
    const text = texts.get(current) || ''
    if (text) parts.push(text)
    current = parents.get(current) ?? null
  }
  return parts.reverse()
}

export function markedNodePathLabel(doc: unknown, anchorUid: string | null | undefined): string {
  return markedNodePathTexts(doc, anchorUid).join('-')
}

/**
 * Splits a root-first path into the row label parts: `root ⋯ anchor`.
 * A single-node path has no root and shows only that node. Empty paths yield empty parts.
 */
export function markedNodePathParts(path: readonly string[]): MarkedNodePathParts {
  const nodes = path.map((text) => String(text || '').trim()).filter(Boolean)
  if (!nodes.length) return { root: null, anchor: '', full: '' }
  const anchor = nodes[nodes.length - 1] ?? ''
  const root = nodes.length > 1 ? nodes[0] ?? null : null
  return { root, anchor, full: nodes.join('-') }
}

/** Visible row text for a path: `根 ⋯ 标记`, or only the node when the path has one node. */
export function formatMarkedNodePath(parts: MarkedNodePathParts): string {
  if (!parts.anchor) return ''
  return parts.root ? `${parts.root} ⋯ ${parts.anchor}` : parts.anchor
}
