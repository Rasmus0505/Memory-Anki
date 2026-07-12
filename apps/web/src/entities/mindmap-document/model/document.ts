export interface MindMapNodeData {
  text?: string
  note?: string
  uid?: string
  memoryAnkiId?: number | null
  memoryAnkiNodeType?: string | null
  memoryAnkiRootKind?: string | null
  [key: string]: unknown
}

export interface MindMapNode {
  data?: MindMapNodeData
  children?: MindMapNode[]
  [key: string]: unknown
}

export interface MindMapDocumentV1 {
  schemaVersion: 1
  root: MindMapNode
  layout?: string
  theme?: Record<string, unknown>
  config?: Record<string, unknown>
  view?: unknown
  [key: string]: unknown
}

export type MindMapDocumentInput = MindMapDocumentV1 | Record<string, unknown> | string | null | undefined

export interface MindMapEditorSnapshot {
  schemaVersion: 1
  document: MindMapDocumentV1
  editorPreferences: Record<string, unknown>
  localPreferences: Record<string, unknown>
  language: string
  revision: string
}

export interface MindMapSelection {
  uid: string | null
  text: string
  note: string
  memoryAnkiId: number | null
  memoryAnkiNodeType: string | null
  rawData: Record<string, unknown>
}

export interface MindMapDocumentCreateResult {
  document: MindMapDocumentV1
  nodeUid: string | null
}

export interface MindMapSearchResult {
  nodeUid: string
  text: string
  note: string
  path: string[]
  ancestorUids: string[]
}

export type MindMapStructureIssueKind = 'empty' | 'long-text' | 'wide-siblings' | 'deep-chain' | 'duplicate-title'

export interface MindMapStructureIssue {
  kind: MindMapStructureIssueKind
  nodeUid: string
  message: string
  path: string[]
}

interface NodeLocation {
  node: MindMapNode
  parent: MindMapNode | null
  index: number
}

const DEFAULT_THEME = { template: 'default', config: {} }

export function parseMindMapDocument(value: MindMapDocumentInput): MindMapDocumentV1 {
  if (!value) return createDefaultDocument()
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object'
        ? normalizeMindMapDocument(parsed as Record<string, unknown>)
        : createDefaultDocument()
    } catch {
      return createDefaultDocument()
    }
  }
  const clone = structuredClone(value) as Partial<MindMapDocumentV1>
  return normalizeMindMapDocument(clone)
}

export function normalizeMindMapDocument(value: MindMapDocumentInput): MindMapDocumentV1 {
  if (typeof value === 'string' || value == null) return parseMindMapDocument(value)
  const document = structuredClone(value) as Partial<MindMapDocumentV1>
  if (!document.root || typeof document.root !== 'object') document.root = makeNode('未命名导图')
  ensureNodeUid(document.root, 'root')
  normalizeChildren(document.root)
  return {
    ...document,
    schemaVersion: 1,
    root: document.root,
    layout: typeof document.layout === 'string' ? document.layout : 'mindMap',
    theme: document.theme && typeof document.theme === 'object' ? document.theme : DEFAULT_THEME,
  }
}

export function selectMindMapNode(documentInput: MindMapDocumentInput, nodeUid: string | null): MindMapSelection[] {
  if (!nodeUid) return []
  const document = normalizeMindMapDocument(documentInput)
  const found = findNode(document.root, nodeUid)
  if (!found) return []
  const data = found.node.data ?? {}
  return [{
    uid: nodeUid,
    text: getMindMapNodeText(found.node),
    note: plainText(data.note),
    memoryAnkiId: typeof data.memoryAnkiId === 'number' ? data.memoryAnkiId : null,
    memoryAnkiNodeType: typeof data.memoryAnkiNodeType === 'string' ? data.memoryAnkiNodeType : null,
    rawData: data,
  }]
}

export function editMindMapNode(document: MindMapDocumentInput, nodeUid: string, text: string) {
  return updateDocument(document, (draft) => {
    const found = findNode(draft.root, nodeUid)
    if (found) found.node.data = { ...(found.node.data ?? {}), text }
  })
}

export function addMindMapChild(document: MindMapDocumentInput, parentUid: string) {
  return addMindMapChildWithResult(document, parentUid).document
}

export function addMindMapChildWithResult(document: MindMapDocumentInput, parentUid: string): MindMapDocumentCreateResult {
  let nodeUid: string | null = null
  const nextDocument = updateDocument(document, (draft) => {
    const found = findNode(draft.root, parentUid)
    if (!found) return
    const created = makeNode('新知识点')
    nodeUid = getMindMapNodeUid(created, '')
    found.node.children = [...(found.node.children ?? []), created]
  })
  return { document: nextDocument, nodeUid }
}

export function addMindMapSibling(document: MindMapDocumentInput, nodeUid: string) {
  return addMindMapSiblingWithResult(document, nodeUid).document
}

export function addMindMapSiblingWithResult(document: MindMapDocumentInput, nodeUid: string): MindMapDocumentCreateResult {
  let createdNodeUid: string | null = null
  const nextDocument = updateDocument(document, (draft) => {
    const found = findNode(draft.root, nodeUid)
    if (!found?.parent) return
    const siblings = found.parent.children ?? []
    const created = makeNode('新知识点')
    createdNodeUid = getMindMapNodeUid(created, '')
    siblings.splice(found.index + 1, 0, created)
    found.parent.children = siblings
  })
  return { document: nextDocument, nodeUid: createdNodeUid }
}

export function deleteMindMapNode(document: MindMapDocumentInput, nodeUid: string) {
  return updateDocument(document, (draft) => {
    const found = findNode(draft.root, nodeUid)
    if (found?.parent) found.parent.children = (found.parent.children ?? []).filter((_, index) => index !== found.index)
  })
}

export function deleteMindMapNodeOnly(document: MindMapDocumentInput, nodeUid: string) {
  return updateDocument(document, (draft) => {
    const found = findNode(draft.root, nodeUid)
    if (!found?.parent) return
    const siblings = found.parent.children ?? []
    siblings.splice(found.index, 1, ...(found.node.children ?? []))
    found.parent.children = siblings
  })
}

export function countMindMapSubtree(document: MindMapDocumentInput, nodeUid: string) {
  const found = findNode(normalizeMindMapDocument(document).root, nodeUid)
  const count = (node: MindMapNode): number => 1 + (node.children ?? []).reduce((total, child) => total + count(child), 0)
  return found ? count(found.node) : 0
}

export function reparentMindMapNode(document: MindMapDocumentInput, sourceUid: string, targetUid: string) {
  return updateDocument(document, (draft) => {
    if (sourceUid === targetUid || isDescendantUid(draft.root, sourceUid, targetUid)) return
    const source = findNode(draft.root, sourceUid)
    const target = findNode(draft.root, targetUid)
    if (!source?.parent || !target) return
    const siblings = source.parent.children ?? []
    const [moved] = siblings.splice(source.index, 1)
    if (!moved) return
    source.parent.children = siblings
    target.node.children = [...(target.node.children ?? []), moved]
  })
}

export function reorderMindMapNode(document: MindMapDocumentInput, sourceUid: string, targetUid: string, position: 'before' | 'after') {
  return updateDocument(document, (draft) => {
    const source = findNode(draft.root, sourceUid)
    const target = findNode(draft.root, targetUid)
    if (!source?.parent || !target?.parent || source.parent !== target.parent) return
    const siblings = source.parent.children ?? []
    const [moved] = siblings.splice(source.index, 1)
    if (!moved) return
    const targetIndex = siblings.findIndex((node) => getMindMapNodeUid(node, '') === targetUid)
    if (targetIndex < 0) return
    siblings.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, moved)
    source.parent.children = siblings
  })
}

export function moveMindMapNode(document: MindMapDocumentInput, nodeUid: string, direction: 'up' | 'down') {
  return updateDocument(document, (draft) => {
    const found = findNode(draft.root, nodeUid)
    if (!found?.parent) return
    const siblings = found.parent.children ?? []
    const targetIndex = direction === 'up' ? found.index - 1 : found.index + 1
    if (targetIndex < 0 || targetIndex >= siblings.length) return
    const [moved] = siblings.splice(found.index, 1)
    if (!moved) return
    siblings.splice(targetIndex, 0, moved)
    found.parent.children = siblings
  })
}

export function canMoveMindMapNode(document: MindMapDocumentInput, nodeUid: string, direction: 'up' | 'down') {
  const found = findNode(normalizeMindMapDocument(document).root, nodeUid)
  if (!found?.parent) return false
  const siblings = found.parent.children ?? []
  return direction === 'up' ? found.index > 0 : found.index < siblings.length - 1
}

export function searchMindMapDocument(document: MindMapDocumentInput, query: string): MindMapSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return []
  const results: MindMapSearchResult[] = []
  const walk = (node: MindMapNode, path: string[], ancestorUids: string[], fallback: string) => {
    const uid = getMindMapNodeUid(node, fallback)
    const text = getMindMapNodeText(node)
    const note = plainText(node.data?.note)
    const nextPath = [...path, text || '未命名知识点']
    if (`${text}\n${note}`.toLocaleLowerCase().includes(normalizedQuery)) results.push({ nodeUid: uid, text, note, path: nextPath, ancestorUids })
    ;(node.children ?? []).forEach((child, index) => walk(child, nextPath, [...ancestorUids, uid], `${fallback}-${index}`))
  }
  walk(normalizeMindMapDocument(document).root, [], [], 'root')
  return results
}

export function auditMindMapDocument(document: MindMapDocumentInput): MindMapStructureIssue[] {
  const issues: MindMapStructureIssue[] = []
  const normalizeTitle = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  const walk = (node: MindMapNode, path: string[], fallback: string, chainDepth: number) => {
    const uid = getMindMapNodeUid(node, fallback)
    const text = getMindMapNodeText(node)
    const nextPath = [...path, text || '未命名知识点']
    if (!text) issues.push({ kind: 'empty', nodeUid: uid, message: '节点标题为空', path: nextPath })
    if (text.length > 80) issues.push({ kind: 'long-text', nodeUid: uid, message: `节点标题 ${text.length} 字，建议拆分`, path: nextPath })
    const children = node.children ?? []
    if (children.length > 12) issues.push({ kind: 'wide-siblings', nodeUid: uid, message: `同级包含 ${children.length} 个节点，建议分组`, path: nextPath })
    const nextChainDepth = children.length === 1 ? chainDepth + 1 : 0
    if (nextChainDepth > 5) issues.push({ kind: 'deep-chain', nodeUid: uid, message: '连续单链超过 5 层，建议压缩层级', path: nextPath })
    const seen = new Map<string, string>()
    children.forEach((child, index) => {
      const childText = getMindMapNodeText(child)
      const key = normalizeTitle(childText)
      if (key && seen.has(key)) issues.push({ kind: 'duplicate-title', nodeUid: getMindMapNodeUid(child, `${fallback}-${index}`), message: `与同级节点“${seen.get(key)}”标题重复`, path: [...nextPath, childText] })
      else if (key) seen.set(key, childText)
    })
    children.forEach((child, index) => walk(child, nextPath, `${fallback}-${index}`, nextChainDepth))
  }
  walk(normalizeMindMapDocument(document).root, [], 'root', 0)
  return issues
}

export function getMindMapNodeUid(node: MindMapNode, fallback: string) {
  return String(node.data?.uid ?? node.data?.memoryAnkiId ?? fallback)
}

export function getMindMapNodeText(node: MindMapNode) {
  return plainText(node.data?.text)
}

function createDefaultDocument(): MindMapDocumentV1 {
  return { schemaVersion: 1, root: makeNode('未命名导图'), layout: 'mindMap', theme: DEFAULT_THEME }
}

function updateDocument(document: MindMapDocumentInput, apply: (draft: MindMapDocumentV1) => void) {
  const draft = normalizeMindMapDocument(document)
  apply(draft)
  return draft
}

function makeNode(text: string): MindMapNode {
  return { data: { text, uid: createUid(), memoryAnkiNodeType: 'peg' }, children: [] }
}

function normalizeChildren(node: MindMapNode) {
  node.children = Array.isArray(node.children) ? node.children : []
  node.children.forEach((child, index) => {
    ensureNodeUid(child, `${getMindMapNodeUid(node, 'node')}-${index}`)
    normalizeChildren(child)
  })
}

function ensureNodeUid(node: MindMapNode, fallback: string) {
  node.data = { ...(node.data ?? {}) }
  if (typeof node.data.uid !== 'string' || !node.data.uid.trim()) node.data.uid = String(node.data.memoryAnkiId ?? fallback ?? createUid())
}

function plainText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function findNode(root: MindMapNode | undefined, uid: string, parent: MindMapNode | null = null, index = 0): NodeLocation | null {
  if (!root) return null
  if (getMindMapNodeUid(root, '') === uid) return { node: root, parent, index }
  const children = root.children ?? []
  for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
    const found = findNode(children[childIndex], uid, root, childIndex)
    if (found) return found
  }
  return null
}

function isDescendantUid(root: MindMapNode | undefined, sourceUid: string, targetUid: string) {
  const source = findNode(root, sourceUid)
  return source ? Boolean(findNode(source.node, targetUid)) : false
}

function createUid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
