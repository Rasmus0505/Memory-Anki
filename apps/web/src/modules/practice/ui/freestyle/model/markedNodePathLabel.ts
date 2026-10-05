/**
 * Round-sheet title: root node through the marked anchor, joined by "-".
 * Queue payloads historically stored only the palace title, so the sheet
 * resolves the path from a palace editor document when one is already loaded.
 */

type DocNode = {
  data?: { uid?: unknown; text?: unknown; memoryAnkiId?: unknown } | null
  children?: DocNode[] | null
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

export function markedNodePathLabel(doc: unknown, anchorUid: string | null | undefined): string {
  const anchor = String(anchorUid || '').trim()
  const root = asRoot(doc)
  if (!anchor || !root) return ''
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
  if (!texts.has(anchor)) return ''
  const parts: string[] = []
  let current: string | null = anchor
  const seen = new Set<string>()
  while (current && texts.has(current) && !seen.has(current)) {
    seen.add(current)
    const text = texts.get(current) || ''
    if (text) parts.push(text)
    current = parents.get(current) ?? null
  }
  return parts.reverse().join('-')
}
