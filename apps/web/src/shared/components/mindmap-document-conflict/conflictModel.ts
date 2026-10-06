import type { MindMapEditorState } from '@/shared/api/contracts'

type JsonObject = Record<string, unknown>
type IndexedDocument = { document: JsonObject; nodes: Map<string, JsonObject>; structure: unknown[] }

function object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function parseDocument(snapshot: MindMapEditorState): JsonObject | null {
  try {
    const value: unknown = typeof snapshot.editor_doc === 'string' ? JSON.parse(snapshot.editor_doc) : snapshot.editor_doc
    return object(value) && object(value.root) ? value : null
  } catch { return null }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
function without(value: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
}
function index(snapshot: MindMapEditorState): IndexedDocument | null {
  const document = parseDocument(snapshot)
  if (!document) return null
  const nodes = new Map<string, JsonObject>()
  const structure: unknown[] = []
  const visit = (node: unknown, parent: string | null): boolean => {
    if (!object(node) || !object(node.data) || typeof node.data.uid !== 'string' || !node.data.uid) return false
    const uid = node.data.uid
    if (nodes.has(uid) || (node.children !== undefined && !Array.isArray(node.children))) return false
    nodes.set(uid, without(node, 'children'))
    structure.push([uid, parent])
    return (node.children as unknown[] | undefined ?? []).every((child) => visit(child, uid))
  }
  return visit(document.root, null) ? { document, nodes, structure } : null
}

export function plainConflictText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

export function summarizeConflictSnapshot(snapshot: MindMapEditorState | null) {
  const document = snapshot && parseDocument(snapshot)
  const lines: string[] = []
  let nodeCount = 0
  const visit = (node: unknown) => {
    if (!object(node)) return
    nodeCount += 1
    const data = object(node.data) ? node.data : {}
    const text = [plainConflictText(data.text), plainConflictText(data.note)].filter(Boolean).join(' — ')
    if (lines.length < 12 && text) lines.push(text.slice(0, 240))
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  if (document) visit(document.root)
  return { title: lines[0] || '无可读标题', nodeCount, lines, readable: Boolean(document) }
}

export type SafeMergeResult = { snapshot: MindMapEditorState; reason: null } | { snapshot: null; reason: string }

/** Conservative three-way merge: no inferred baseline, topology repair, or UID creation.
 * Each node (including rich text and extension fields) is atomic. Disjoint node
 * edits combine; competing edits, additions/deletions/moves require explicit recovery.
 */
export function mergeIndependentNodeEdits(
  baseline: MindMapEditorState | null | undefined,
  local: MindMapEditorState,
  remote: MindMapEditorState | null,
): SafeMergeResult {
  const fail = (reason: string): SafeMergeResult => ({ snapshot: null, reason })
  if (!baseline) return fail('没有共同基线快照，不能安全进行三方合并。请选用一方或下载双方后手动整理。')
  if (!remote) return fail('远端快照尚不可用，暂不能合并或选用远端。')
  const baseIndex = index(baseline), localIndex = index(local), remoteIndex = index(remote)
  if (!baseIndex || !localIndex || !remoteIndex) return fail('文档格式或节点 UID 不完整／重复，无法安全合并。')
  if (stable(baseIndex.structure) !== stable(localIndex.structure) || stable(baseIndex.structure) !== stable(remoteIndex.structure)) {
    return fail('节点新增、删除、移动或排序发生变化，请下载双方后手动整理；不会自动猜测结构。')
  }
  const conflicts: string[] = []
  const pick = (base: unknown, left: unknown, right: unknown, label: string): unknown => {
    if (stable(left) === stable(right) || stable(right) === stable(base)) return left
    if (stable(left) === stable(base)) return right
    conflicts.push(label)
    return left
  }
  const mergedNodes = new Map<string, JsonObject>()
  for (const [uid, node] of baseIndex.nodes) {
    mergedNodes.set(uid, pick(node, localIndex.nodes.get(uid), remoteIndex.nodes.get(uid), `节点 ${uid}`) as JsonObject)
  }
  const rebuild = (node: unknown): JsonObject => {
    const source = node as JsonObject
    const uid = (source.data as JsonObject).uid as string
    return { ...mergedNodes.get(uid), ...(Array.isArray(source.children) ? { children: source.children.map(rebuild) } : {}) }
  }
  const envelope = pick(without(baseIndex.document, 'root'), without(localIndex.document, 'root'), without(remoteIndex.document, 'root'), '文档属性') as JsonObject
  const snapshot: MindMapEditorState = {
    ...remote,
    editor_doc: { ...envelope, root: rebuild(baseIndex.document.root) },
    editor_config: pick(baseline.editor_config, local.editor_config, remote.editor_config, '编辑配置') as JsonObject,
    editor_local_config: pick(baseline.editor_local_config, local.editor_local_config, remote.editor_local_config, '本地配置') as JsonObject,
    lang: pick(baseline.lang, local.lang, remote.lang, '语言') as string,
  }
  return conflicts.length ? fail(`双方同时修改了${conflicts.slice(0, 5).join('、')}，不能自动安全合并。`) : { snapshot, reason: null }
}
