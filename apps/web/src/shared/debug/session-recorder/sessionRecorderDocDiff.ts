import { truncateRecorderText } from './sessionRecorderFormat'

interface FlatNode {
  uid: string
  title: string
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

function nodeTitle(node: Record<string, unknown>) {
  const data = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>) : null
  return truncateRecorderText(String(data?.text ?? data?.label ?? ''))
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
    nodes.set(uid, { uid, title: nodeTitle(record), parent })
    const children = Array.isArray(record.children) ? record.children : []
    children.forEach((child, index) => walk(child, uid, `${uid}-${index}`))
  }

  walk(root, null, 'root')
  return nodes
}

function shortSuffix(uid: string) {
  const compact = uid.replace(/-/g, '')
  return compact.slice(-4) || uid.slice(-4)
}

function titleCounts(nodes: Iterable<FlatNode>) {
  const byUid = new Map<string, FlatNode>()
  for (const node of nodes) byUid.set(node.uid, node)
  const counts = new Map<string, number>()
  for (const node of byUid.values()) {
    const title = node.title || '未命名'
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }
  return counts
}

function formatNode(
  node: FlatNode | undefined,
  counts: Map<string, number>,
  fallback = '根',
) {
  if (!node) return fallback
  const title = node.title || '未命名'
  if ((counts.get(title) ?? 0) > 1) return `「${title}」#${shortSuffix(node.uid)}`
  return `「${title}」`
}

export function summarizeEditorDocChange(previous: unknown, next: unknown) {
  const before = flattenEditorDoc(previous)
  const after = flattenEditorDoc(next)
  const counts = titleCounts([...before.values(), ...after.values()])
  const parts: string[] = []

  for (const [uid, node] of after) {
    if (!before.has(uid)) {
      const parent = node.parent
        ? ` 父=${formatNode(after.get(node.parent) ?? before.get(node.parent), counts)}`
        : ''
      parts.push(`新增 ${formatNode(node, counts)}${parent}`)
    }
  }
  for (const [uid, node] of before) {
    if (!after.has(uid)) {
      parts.push(`删除 ${formatNode(node, counts)}`)
    }
  }
  for (const [uid, node] of after) {
    const prior = before.get(uid)
    if (!prior) continue
    if (prior.parent !== node.parent) {
      parts.push(
        `移动 ${formatNode(node, counts)} ${formatNode(before.get(prior.parent ?? ''), counts)} → ${formatNode(after.get(node.parent ?? ''), counts)}`,
      )
    } else if (prior.title !== node.title) {
      parts.push(`改文本 「${prior.title || '未命名'}」→${formatNode(node, counts)}`)
    }
  }

  if (parts.length === 0) return '文档已更新'
  return parts.slice(0, 12).join('；')
}

function quotedTitles(titles: string[]) {
  const shown = titles.slice(0, 3).map((title) => `「${truncateRecorderText(title || '未命名')}」`)
  const extra = titles.length > 3 ? `等${titles.length}张` : ''
  return `${shown.join('')}${extra}`
}

export function summarizeRevealMapChange(
  previous: Record<string, string> | null | undefined,
  next: Record<string, string>,
  titleOf: (id: string) => string,
) {
  const opened: string[] = []
  const closed: string[] = []
  const ids = new Set([...Object.keys(previous ?? {}), ...Object.keys(next)])
  for (const id of ids) {
    const was = previous?.[id] ?? 'hidden'
    const now = next[id] ?? 'hidden'
    if (was !== 'revealed' && now === 'revealed') opened.push(titleOf(id))
    if (was === 'revealed' && now !== 'revealed') closed.push(titleOf(id))
  }
  const parts = [
    opened.length ? `翻开${quotedTitles(opened)}` : '',
    closed.length ? `收起${quotedTitles(closed)}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('；') : null
}
