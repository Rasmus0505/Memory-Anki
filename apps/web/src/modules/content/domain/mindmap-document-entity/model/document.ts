import { highlightEntireNodeText } from '@/shared/lib/mindmapRichText'

export interface MindMapNodeData {
  text?: string
  note?: string
  uid?: string
  memoryAnkiId?: number | null
  memoryAnkiNodeType?: string | null
  memoryAnkiRootKind?: string | null
  /** When true, parent reveal auto-shows this node's body during review flip. */
  memoryAnkiQuestionCard?: boolean
  /**
   * Editor-only card fill mark (CSS color, e.g. `#fecaca`).
   * Not applied in review/practice projections.
   */
  markColor?: string | null
  /** Anki presentation role: front / back / none (explicit). Unset = infer. */
  ankiRole?: 'front' | 'back' | 'none'
  /** When ankiRole is back, optional explicit front uid (overrides parent inference). */
  ankiFrontUid?: string
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

/** Stored node text as-is (may include yellow-emphasis HTML). */
export function getMindMapNodeStoredText(node: MindMapNode): string {
  return typeof node.data?.text === 'string' ? node.data.text : ''
}

/** Look up stored text (including highlight markup) by node uid. */
export function getMindMapStoredTextByUid(
  documentInput: MindMapDocumentInput,
  nodeUid: string | null | undefined,
): string {
  if (!nodeUid) return ''
  const document = normalizeMindMapDocument(documentInput)
  const found = findNode(document.root, nodeUid)
  if (!found) return ''
  return getMindMapNodeStoredText(found.node)
}

export function editMindMapNode(document: MindMapDocumentInput, nodeUid: string, text: string) {
  return updateDocument(document, (draft) => {
    const found = findNode(draft.root, nodeUid)
    if (!found) return
    applyNodeText(found.node, text)
  })
}

/**
 * Apply full-card yellow emphasis markup to one or more nodes.
 * Uses the shared highlight HTML format (`data-emphasis="highlight"`).
 */
export function highlightMindMapNodes(
  document: MindMapDocumentInput,
  nodeUids: readonly string[],
): { document: MindMapDocumentV1; count: number } {
  const uids = uniqueUids(nodeUids)
  let count = 0
  const nextDocument = updateDocument(document, (draft) => {
    for (const uid of uids) {
      const found = findNode(draft.root, uid)
      if (!found) continue
      const raw = typeof found.node.data?.text === 'string' ? found.node.data.text : ''
      const highlighted = highlightEntireNodeText(raw)
      if (!highlighted) continue
      applyNodeText(found.node, highlighted)
      count += 1
    }
  })
  return { document: nextDocument, count }
}

export function isMindMapQuestionCard(node: MindMapNode | null | undefined): boolean {
  return node?.data?.memoryAnkiQuestionCard === true
}

/** Normalize a CSS color string for markColor storage; empty/invalid → null. */
export function normalizeMindMapMarkColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Allow #rgb / #rrggbb / #rrggbbaa and common rgb()/hsl() forms used by color inputs.
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^(rgb|hsl)a?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?\s*)?\)$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, ' ')
  }
  return null
}

export function getMindMapMarkColor(node: MindMapNode | null | undefined): string | null {
  return normalizeMindMapMarkColor(node?.data?.markColor)
}

/**
 * Set or clear card mark color on one or more nodes.
 * Pass `color: null` (or empty) to clear. Returns how many nodes changed.
 */
export function setMindMapMarkColors(
  document: MindMapDocumentInput,
  nodeUids: readonly string[],
  color: string | null,
): { document: MindMapDocumentV1; count: number } {
  const uids = uniqueUids(nodeUids)
  const nextColor = normalizeMindMapMarkColor(color)
  let count = 0
  const nextDocument = updateDocument(document, (draft) => {
    for (const uid of uids) {
      if (!uid) continue
      const found = findNode(draft.root, uid)
      if (!found) continue
      const current = getMindMapMarkColor(found.node)
      if (current === nextColor) continue
      const nextData: MindMapNodeData = { ...(found.node.data ?? {}) }
      if (nextColor) {
        nextData.markColor = nextColor
      } else {
        delete nextData.markColor
      }
      found.node.data = nextData
      count += 1
    }
  })
  return { document: nextDocument, count }
}

/**
 * Batch set/clear the question-card flag on non-root nodes.
 * Root is skipped so palace roots cannot become auto-revealed question cards.
 */
export function setMindMapQuestionCards(
  document: MindMapDocumentInput,
  nodeUids: readonly string[],
  enabled: boolean,
): { document: MindMapDocumentV1; count: number } {
  const uids = uniqueUids(nodeUids)
  let count = 0
  const nextDocument = updateDocument(document, (draft) => {
    const rootUid = getMindMapNodeUid(draft.root, 'root')
    for (const uid of uids) {
      if (!uid || uid === rootUid) continue
      const found = findNode(draft.root, uid)
      if (!found || !found.parent) continue
      const currentlyEnabled = found.node.data?.memoryAnkiQuestionCard === true
      if (currentlyEnabled === enabled) continue
      const nextData: MindMapNodeData = { ...(found.node.data ?? {}) }
      if (enabled) {
        nextData.memoryAnkiQuestionCard = true
      } else {
        delete nextData.memoryAnkiQuestionCard
      }
      found.node.data = nextData
      count += 1
    }
  })
  return { document: nextDocument, count }
}

/**
 * Cycle Anki role on a node: none → front → back → none (stored explicitly).
 * Root is skipped. Returns the role after the click (for toast/UI).
 */
export function cycleMindMapAnkiRole(
  document: MindMapDocumentInput,
  nodeUid: string,
): { document: MindMapDocumentV1; role: 'front' | 'back' | 'none'; changed: boolean } {
  let nextRole: 'front' | 'back' | 'none' = 'none'
  let changed = false
  const nextDocument = updateDocument(document, (draft) => {
    const rootUid = getMindMapNodeUid(draft.root, 'root')
    if (!nodeUid || nodeUid === rootUid) return
    const found = findNode(draft.root, nodeUid)
    if (!found) return
    const current = found.node.data?.ankiRole
    const from: 'front' | 'back' | 'none' =
      current === 'front' || current === 'back' || current === 'none' ? current : 'none'
    nextRole = from === 'none' ? 'front' : from === 'front' ? 'back' : 'none'
    const nextData: MindMapNodeData = { ...(found.node.data ?? {}) }
    if (nextRole === 'none') {
      delete nextData.ankiRole
      delete nextData.ankiFrontUid
    } else {
      nextData.ankiRole = nextRole
      if (nextRole !== 'back') delete nextData.ankiFrontUid
    }
    found.node.data = nextData
    changed = true
  })
  return { document: nextDocument, role: nextRole, changed }
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

/**
 * Insert nodes as **siblings after** the selected node (same parent).
 * If the selected node is the root, append as first-level children of the root.
 * Never inserts as children of a non-root selected node.
 */
export function insertMindMapSiblingsAfter(
  document: MindMapDocumentInput,
  selectedUid: string,
  nodes: MindMapNode[],
): MindMapDocumentV1 {
  const uid = String(selectedUid || '').trim()
  if (!uid) {
    throw new Error('请先在脑图上选中一张卡片。')
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('没有可追加的节点。')
  }
  return updateDocument(document, (draft) => {
    const found = findNode(draft.root, uid)
    if (!found) {
      throw new Error('未找到当前选中卡片，请重新点选后再追加。')
    }
    // Root has no parent: first-level cards under root (still "同级" under the palace root).
    if (!found.parent) {
      draft.root.children = [...(draft.root.children ?? []), ...nodes]
      return
    }
    const siblings = [...(found.parent.children ?? [])]
    siblings.splice(found.index + 1, 0, ...nodes)
    found.parent.children = siblings
  })
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

export type MindMapRelocateMode = 'inside' | 'before' | 'after'

export function reparentMindMapNode(document: MindMapDocumentInput, sourceUid: string, targetUid: string) {
  return relocateMindMapNode(document, sourceUid, targetUid, 'inside')
}

/**
 * Move a node relative to a target:
 * - inside: become last child of target
 * - before/after: become sibling of target (same parent); works across parents
 */
export function relocateMindMapNode(
  document: MindMapDocumentInput,
  sourceUid: string,
  targetUid: string,
  mode: MindMapRelocateMode,
) {
  return relocateMindMapNodes(document, [sourceUid], targetUid, mode)
}

/**
 * Move one or more nodes. Only top-level sources (not descendants of other sources) move.
 * Order follows document preorder so relative sibling order is preserved.
 */
export function relocateMindMapNodes(
  document: MindMapDocumentInput,
  sourceUids: readonly string[],
  targetUid: string,
  mode: MindMapRelocateMode,
) {
  return updateDocument(document, (draft) => {
    const uniqueSources = uniqueUids(sourceUids)
    if (uniqueSources.length === 0) return

    const topLevelSources = selectTopLevelSourceUids(draft.root, uniqueSources).filter(
      (sourceUid) => sourceUid !== targetUid,
    )
    if (topLevelSources.length === 0) return

    for (const sourceUid of topLevelSources) {
      // Target under source would create a cycle (inside) or detach the target (before/after).
      if (isDescendantUid(draft.root, sourceUid, targetUid)) return
    }

    const target = findNode(draft.root, targetUid)
    if (!target) return
    if ((mode === 'before' || mode === 'after') && !target.parent) return

    // Detach first so indices stay consistent, preserving document order.
    const detached: MindMapNode[] = []
    for (const sourceUid of topLevelSources) {
      const source = findNode(draft.root, sourceUid)
      if (!source?.parent) continue
      const siblings = source.parent.children ?? []
      const [moved] = siblings.splice(source.index, 1)
      if (!moved) continue
      source.parent.children = siblings
      detached.push(moved)
    }
    if (detached.length === 0) return

    if (mode === 'inside') {
      const nextTarget = findNode(draft.root, targetUid)
      if (!nextTarget) return
      nextTarget.node.children = [...(nextTarget.node.children ?? []), ...detached]
      return
    }

    const nextTarget = findNode(draft.root, targetUid)
    if (!nextTarget?.parent) return
    const siblings = nextTarget.parent.children ?? []
    const targetIndex = siblings.findIndex((node) => getMindMapNodeUid(node, '') === targetUid)
    if (targetIndex < 0) return
    const insertAt = mode === 'before' ? targetIndex : targetIndex + 1
    siblings.splice(insertAt, 0, ...detached)
    nextTarget.parent.children = siblings
  })
}

/** Delete many non-root nodes. Deletes deepest nodes first so parents are not removed before children ops. */
export function deleteMindMapNodes(document: MindMapDocumentInput, nodeUids: readonly string[]) {
  return updateDocument(document, (draft) => {
    const unique = uniqueUids(nodeUids)
    if (unique.length === 0) return
    const ordered = orderUidsDeepestFirst(draft.root, unique)
    for (const uid of ordered) {
      const found = findNode(draft.root, uid)
      if (!found?.parent) continue
      found.parent.children = (found.parent.children ?? []).filter((_, index) => index !== found.index)
    }
  })
}

export type MindMapExtractPlacement =
  | { mode: 'inside'; targetUid: string }
  | { mode: 'before' | 'after'; targetUid: string }

export interface MindMapExtractSelectionResult extends MindMapDocumentCreateResult {
  extractedText: string | null
}

/**
 * Cut a text range out of a node and insert it as a new card at the placement.
 * Uses the live editor text (not re-trimmed document text) so selection indices match the textarea.
 */
export function extractMindMapSelectionWithResult(
  document: MindMapDocumentInput,
  sourceUid: string,
  liveText: string,
  start: number,
  end: number,
  placement: MindMapExtractPlacement,
): MindMapExtractSelectionResult {
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(liveText.length, Math.max(start, end))
  const extractedRaw = liveText.slice(from, to)
  const extractedText = extractedRaw.replace(/\s+/g, ' ').trim()
  if (!extractedText) {
    return { document: normalizeMindMapDocument(document), nodeUid: null, extractedText: null }
  }
  const remaining = `${liveText.slice(0, from)}${liveText.slice(to)}`
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  let nodeUid: string | null = null
  const nextDocument = updateDocument(document, (draft) => {
    const source = findNode(draft.root, sourceUid)
    if (!source) return
    source.node.data = { ...(source.node.data ?? {}), text: remaining }

    const created = makeNode(extractedText)
    nodeUid = getMindMapNodeUid(created, '')

    if (placement.mode === 'inside') {
      const target = findNode(draft.root, placement.targetUid)
      if (!target) {
        nodeUid = null
        return
      }
      target.node.children = [...(target.node.children ?? []), created]
      return
    }

    const target = findNode(draft.root, placement.targetUid)
    if (!target?.parent) {
      // Root has no parent — fall back to child of target.
      if (target) {
        target.node.children = [...(target.node.children ?? []), created]
        return
      }
      nodeUid = null
      return
    }
    const siblings = target.parent.children ?? []
    const insertAt = placement.mode === 'before' ? target.index : target.index + 1
    siblings.splice(insertAt, 0, created)
    target.parent.children = siblings
  })

  return { document: nextDocument, nodeUid, extractedText }
}

export function reorderMindMapNode(
  document: MindMapDocumentInput,
  sourceUid: string,
  targetUid: string,
  position: 'before' | 'after',
) {
  // Cross-parent before/after now relocates as sibling; same-parent keeps reorder semantics.
  return relocateMindMapNode(document, sourceUid, targetUid, position)
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

function applyNodeText(node: MindMapNode, text: string) {
  const nextData: MindMapNodeData = { ...(node.data ?? {}), text }
  if (typeof text === 'string' && /data-emphasis=["']highlight["']/.test(text)) {
    nextData.richText = true
  } else {
    delete nextData.richText
    // Prefer plain text storage when no highlight markup remains.
    if (typeof text === 'string' && /<[^>]+>/.test(text) && !/data-emphasis=["']highlight["']/.test(text)) {
      nextData.text = plainText(text) || text
    }
  }
  node.data = nextData
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

function uniqueUids(uids: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const uid of uids) {
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    result.push(uid)
  }
  return result
}

/** Keep sources that are not descendants of another source (document preorder). */
function selectTopLevelSourceUids(root: MindMapNode, sourceUids: readonly string[]) {
  const sourceSet = new Set(sourceUids)
  const topLevel: string[] = []
  const walk = (node: MindMapNode, underSelectedAncestor: boolean, fallback: string) => {
    const uid = getMindMapNodeUid(node, fallback)
    const isSelected = sourceSet.has(uid)
    if (isSelected && !underSelectedAncestor) topLevel.push(uid)
    const nextUnder = underSelectedAncestor || isSelected
    ;(node.children ?? []).forEach((child, index) => walk(child, nextUnder, `${uid}-${index}`))
  }
  walk(root, false, 'root')
  return topLevel
}

function orderUidsDeepestFirst(root: MindMapNode, uids: readonly string[]) {
  const uidSet = new Set(uids)
  const ranked: Array<{ uid: string; depth: number; order: number }> = []
  let order = 0
  const walk = (node: MindMapNode, depth: number, fallback: string) => {
    const uid = getMindMapNodeUid(node, fallback)
    if (uidSet.has(uid)) ranked.push({ uid, depth, order: order++ })
    ;(node.children ?? []).forEach((child, index) => walk(child, depth + 1, `${uid}-${index}`))
  }
  walk(root, 0, 'root')
  ranked.sort((a, b) => b.depth - a.depth || b.order - a.order)
  return ranked.map((item) => item.uid)
}

function createUid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
