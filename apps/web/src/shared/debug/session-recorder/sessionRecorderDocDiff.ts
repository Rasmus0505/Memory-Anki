interface FlatNode {
  uid: string
  parent: string | null
}

function parseDoc(value: unknown): { root?: unknown } | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as { root?: unknown }) : null
    } catch {
      return null
    }
  }
  if (typeof value === 'object') return value as { root?: unknown }
  return null
}

function nodeUid(node: Record<string, unknown>, fallback: string) {
  const data = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>) : null
  if (data?.uid != null && String(data.uid).trim()) return String(data.uid)
  if (data?.memoryAnkiId != null && String(data.memoryAnkiId).trim()) return String(data.memoryAnkiId)
  return fallback
}

function flattenEditorDoc(value: unknown) {
  const nodes = new Map<string, FlatNode>()
  const parsed = parseDoc(value)
  const root = parsed?.root && typeof parsed.root === 'object' ? parsed.root : parsed
  if (!root || typeof root !== 'object') return nodes

  const walk = (node: unknown, parent: string | null, fallback: string) => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const uid = nodeUid(record, fallback)
    nodes.set(uid, { uid, parent })
    const children = Array.isArray(record.children) ? record.children : []
    children.forEach((child, index) => walk(child, uid, `${uid}-${index}`))
  }

  walk(root, null, 'root')
  return nodes
}

export function summarizeEditorDocChange(previous: unknown, next: unknown) {
  const before = flattenEditorDoc(previous)
  const after = flattenEditorDoc(next)
  let added = 0
  let removed = 0
  let moved = 0
  for (const [uid, node] of after) {
    if (!before.has(uid)) added += 1
    else if (before.get(uid)?.parent !== node.parent) moved += 1
  }
  for (const uid of before.keys()) if (!after.has(uid)) removed += 1
  const parts = [
    added ? `新增节点 ${added}` : '',
    removed ? `删除节点 ${removed}` : '',
    moved ? `移动节点 ${moved}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('，') : '文档已更新'
}

export function summarizeRevealMapChange(
  previous: Record<string, string> | null | undefined,
  next: Record<string, string>,
) {
  let opened = 0
  let closed = 0
  const ids = new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])
  for (const id of ids) {
    const was = previous?.[id] ?? 'hidden'
    const now = next[id] ?? 'hidden'
    if (was !== 'revealed' && now === 'revealed') opened += 1
    if (was === 'revealed' && now !== 'revealed') closed += 1
  }
  const parts = [
    opened ? `翻开 ${opened} 项` : '',
    closed ? `收起 ${closed} 项` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('，') : null
}
