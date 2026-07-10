import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapEditorState,
  MindMapHostSegmentRangeDraft,
  MindMapHostSegmentSummary,
} from '@/shared/api/contracts'
import type { GraphData, MindMapNode } from './adapter'
import { BRANCH_COLORS } from './branchColors'

type RevealState = 'hidden' | 'placeholder' | 'revealed'

export interface EditorDocGraphOptions {
  segments?: MindMapHostSegmentSummary[]
  activeSegmentId?: number | null
  segmentColorMode?: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft?: MindMapHostSegmentRangeDraft
  focusNodeUids?: string[]
  miniPalaceDraft?: {
    active: boolean
    selectedNodeUids: string[]
  }
  revealMap?: Record<string, RevealState>
  readonly?: boolean
  highlightedNodeUids?: string[]
  masteryByNodeUid?: Record<string, { status: string; manualLabel?: string | null }>
}

interface NodeLocation {
  node: MindMapDocNode
  parent: MindMapDocNode | null
  index: number
}

export interface EditorDocCreateResult {
  editorDoc: MindMapDoc
  nodeUid: string | null
}

const DEFAULT_THEME = { template: 'default' as const, config: {} as const }

export function parseEditorDoc(value: MindMapEditorState['editor_doc']): MindMapDoc {
  if (!value) return { root: makeNode('未命名导图'), layout: 'mindMap', theme: DEFAULT_THEME }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object'
        ? (parsed as MindMapDoc)
        : { root: makeNode('未命名导图'), layout: 'mindMap', theme: DEFAULT_THEME }
    } catch {
      return { root: makeNode('未命名导图'), layout: 'mindMap', theme: DEFAULT_THEME }
    }
  }
  return structuredClone(value) as MindMapDoc
}

export function normalizeEditorDocTree(value: MindMapEditorState['editor_doc']): MindMapDoc {
  const doc = parseEditorDoc(value)
  if (!doc.root) {
    doc.root = makeNode('未命名导图')
  }
  ensureNodeUid(doc.root, 'root')
  normalizeChildren(doc.root)
  return {
    layout: 'mindMap',
    theme: DEFAULT_THEME,
    ...doc,
  }
}

export function editorDocToGraph(
  editorDoc: MindMapEditorState['editor_doc'],
  options: EditorDocGraphOptions = {},
): GraphData {
  const doc = normalizeEditorDocTree(editorDoc)
  const nodes: MindMapNode[] = []
  const edges: GraphData['edges'] = []
  const segmentByNodeUid = buildSegmentByNodeUid(options.segments ?? [])
  const rangeSelected = new Set(options.segmentRangeDraft?.selectedNodeUids ?? [])
  const focusSet = new Set(options.focusNodeUids ?? [])
  const miniSet = new Set(options.miniPalaceDraft?.selectedNodeUids ?? [])
  const highlightedSet = new Set(options.highlightedNodeUids ?? [])

  const walk = (node: MindMapDocNode, parentId: string | null, depth: number, indexPath: number[]) => {
    const uid = getNodeUid(node, indexPath.join('-') || 'root')
    const text = getNodeText(node) || (depth === 0 ? '未命名导图' : '未命名知识点')
    const segment = segmentByNodeUid.get(uid) ?? null
    const activeSegment = segment != null && segment.id === options.activeSegmentId
    const segmentVisible =
      segment != null &&
      (options.segmentColorMode !== 'active-only' || activeSegment)
    const revealState = options.revealMap?.[uid]
    const branchColor = BRANCH_COLORS[(indexPath[0] ?? 0) % BRANCH_COLORS.length]
    nodes.push({
      id: uid,
      type: 'peg',
      label: text,
      originalId: nodes.length + 1,
      parentId,
      metadata: {
        ...(node.data ?? {}),
        depth,
        uid,
        layoutRole: depth === 0 ? 'root' : depth >= 2 ? 'leaf' : 'branch',
        branchColor,
        rawNode: node,
        revealState,
        segmentColor: rangeSelected.has(uid) ? '#0ea5e9' : segmentVisible ? segment?.color : null,
        activeSegment,
        muted:
          options.segmentColorMode === 'active-only' &&
          segment != null &&
          !activeSegment,
        focusMarked: focusSet.has(uid),
        miniPalaceSelected: miniSet.has(uid),
        searchHighlighted: highlightedSet.has(uid),
        masteryStatus: options.masteryByNodeUid?.[uid]?.status ?? null,
        manualMasteryLabel: options.masteryByNodeUid?.[uid]?.manualLabel ?? null,
      },
    })
    if (parentId) {
      const renderStyle = options.revealMap ? getRuntimeEdgeRenderStyle(node.data) : undefined
      edges.push({
        id: `${parentId}->${uid}`,
        source: parentId,
        target: uid,
        type: 'parent-child',
        renderStyle,
      })
    }
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, childIndex) => walk(child, uid, depth + 1, [...indexPath, childIndex]))
  }

  walk(doc.root, null, 0, [])
  return { nodes, edges }
}

function getRuntimeEdgeRenderStyle(data: MindMapDocNode['data']) {
  const stroke = typeof data?.lineColor === 'string' ? data.lineColor.trim() : ''
  const strokeWidth = typeof data?.lineWidth === 'number' ? data.lineWidth : Number.NaN
  if (!stroke || !Number.isFinite(strokeWidth) || strokeWidth <= 0) return undefined
  return { stroke, strokeWidth }
}

export function buildSelectionFromDoc(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string | null,
) {
  if (!nodeUid) return []
  const doc = normalizeEditorDocTree(editorDoc)
  const found = findNode(doc.root, nodeUid)
  if (!found) return []
  const data = found.node.data ?? {}
  return [{
    uid: nodeUid,
    text: getNodeText(found.node),
    note: plainText(data.note),
    memoryAnkiId: typeof data.memoryAnkiId === 'number' ? data.memoryAnkiId : null,
    memoryAnkiNodeType:
      typeof data.memoryAnkiNodeType === 'string' ? data.memoryAnkiNodeType : null,
    rawData: data,
  }]
}

export function editEditorDocNode(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
  text: string,
) {
  return updateDoc(editorDoc, (doc) => {
    const found = findNode(doc.root, nodeUid)
    if (!found) return
    found.node.data = { ...(found.node.data ?? {}), text }
  })
}

export function addEditorDocChild(
  editorDoc: MindMapEditorState['editor_doc'],
  parentUid: string,
) {
  return addEditorDocChildWithResult(editorDoc, parentUid).editorDoc
}

export function addEditorDocChildWithResult(
  editorDoc: MindMapEditorState['editor_doc'],
  parentUid: string,
): EditorDocCreateResult {
  let nodeUid: string | null = null
  const nextDoc = updateDoc(editorDoc, (doc) => {
    const found = findNode(doc.root, parentUid)
    if (!found) return
    const created = makeNode('新知识点')
    nodeUid = getNodeUid(created, '')
    found.node.children = [...(found.node.children ?? []), created]
  })
  return { editorDoc: nextDoc, nodeUid }
}

export function addEditorDocSibling(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
) {
  return addEditorDocSiblingWithResult(editorDoc, nodeUid).editorDoc
}

export function addEditorDocSiblingWithResult(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
): EditorDocCreateResult {
  let createdNodeUid: string | null = null
  const nextDoc = updateDoc(editorDoc, (doc) => {
    const found = findNode(doc.root, nodeUid)
    if (!found?.parent) return
    const siblings = found.parent.children ?? []
    const created = makeNode('新知识点')
    createdNodeUid = getNodeUid(created, '')
    siblings.splice(found.index + 1, 0, created)
    found.parent.children = siblings
  })
  return { editorDoc: nextDoc, nodeUid: createdNodeUid }
}

export function deleteEditorDocNode(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
) {
  return updateDoc(editorDoc, (doc) => {
    const found = findNode(doc.root, nodeUid)
    if (!found?.parent) return
    found.parent.children = (found.parent.children ?? []).filter((_, index) => index !== found.index)
  })
}

export function deleteEditorDocNodeOnly(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
) {
  return updateDoc(editorDoc, (doc) => {
    const found = findNode(doc.root, nodeUid)
    if (!found?.parent) return
    const siblings = found.parent.children ?? []
    siblings.splice(found.index, 1, ...(found.node.children ?? []))
    found.parent.children = siblings
  })
}

export function countEditorDocSubtree(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
) {
  const doc = normalizeEditorDocTree(editorDoc)
  const found = findNode(doc.root, nodeUid)
  if (!found) return 0
  const count = (node: MindMapDocNode): number =>
    1 + (node.children ?? []).reduce((total, child) => total + count(child), 0)
  return count(found.node)
}

export function reparentEditorDocNode(
  editorDoc: MindMapEditorState['editor_doc'],
  sourceUid: string,
  targetUid: string,
) {
  return updateDoc(editorDoc, (doc) => {
    if (sourceUid === targetUid || isDescendantUid(doc.root, sourceUid, targetUid)) return
    const source = findNode(doc.root, sourceUid)
    const target = findNode(doc.root, targetUid)
    if (!source?.parent || !target) return
    const [moved] = (source.parent.children ?? []).splice(source.index, 1)
    if (!moved) return
    target.node.children = [...(target.node.children ?? []), moved]
  })
}

export function reorderEditorDocNode(
  editorDoc: MindMapEditorState['editor_doc'],
  sourceUid: string,
  targetUid: string,
  position: 'before' | 'after',
) {
  return updateDoc(editorDoc, (doc) => {
    const source = findNode(doc.root, sourceUid)
    const target = findNode(doc.root, targetUid)
    if (!source?.parent || !target?.parent || source.parent !== target.parent) return
    const siblings = source.parent.children ?? []
    const [moved] = siblings.splice(source.index, 1)
    if (!moved) return
    const nextTargetIndex = siblings.findIndex((node) => getNodeUid(node, '') === targetUid)
    if (nextTargetIndex < 0) return
    siblings.splice(position === 'before' ? nextTargetIndex : nextTargetIndex + 1, 0, moved)
    source.parent.children = siblings
  })
}

export function moveEditorDocNode(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
  direction: 'up' | 'down',
) {
  return updateDoc(editorDoc, (doc) => {
    const found = findNode(doc.root, nodeUid)
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

export function canMoveEditorDocNode(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
  direction: 'up' | 'down',
) {
  const doc = normalizeEditorDocTree(editorDoc)
  const found = findNode(doc.root, nodeUid)
  if (!found?.parent) return false
  const siblings = found.parent.children ?? []
  return direction === 'up' ? found.index > 0 : found.index < siblings.length - 1
}

function updateDoc(
  editorDoc: MindMapEditorState['editor_doc'],
  apply: (doc: MindMapDoc) => void,
) {
  const doc = normalizeEditorDocTree(editorDoc)
  apply(doc)
  return doc
}

function makeNode(text: string): MindMapDocNode {
  return {
    data: {
      text,
      uid: createUid(),
      memoryAnkiNodeType: 'peg',
    },
    children: [],
  }
}

function normalizeChildren(node: MindMapDocNode) {
  node.children = Array.isArray(node.children) ? node.children : []
  node.children.forEach((child, index) => {
    ensureNodeUid(child, `${getNodeUid(node, 'node')}-${index}`)
    normalizeChildren(child)
  })
}

function ensureNodeUid(node: MindMapDocNode, fallback: string) {
  node.data = { ...(node.data ?? {}) }
  if (typeof node.data.uid !== 'string' || !node.data.uid.trim()) {
    node.data.uid = String(node.data.memoryAnkiId ?? fallback ?? createUid())
  }
}

function getNodeUid(node: MindMapDocNode, fallback: string) {
  const data = node.data ?? {}
  return String(data.uid ?? data.memoryAnkiId ?? fallback)
}

function getNodeText(node: MindMapDocNode) {
  return plainText(node.data?.text)
}

function plainText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function findNode(
  root: MindMapDocNode | undefined,
  uid: string,
  parent: MindMapDocNode | null = null,
  index = 0,
): NodeLocation | null {
  if (!root) return null
  if (getNodeUid(root, '') === uid) return { node: root, parent, index }
  const children = root.children ?? []
  for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
    const found = findNode(children[childIndex], uid, root, childIndex)
    if (found) return found
  }
  return null
}

function isDescendantUid(root: MindMapDocNode | undefined, sourceUid: string, targetUid: string) {
  const source = findNode(root, sourceUid)
  if (!source) return false
  return Boolean(findNode(source.node, targetUid))
}

function buildSegmentByNodeUid(segments: MindMapHostSegmentSummary[]) {
  const map = new Map<string, MindMapHostSegmentSummary>()
  segments.forEach((segment) => {
    segment.node_uids.forEach((uid) => {
      map.set(uid, segment)
    })
  })
  return map
}

function createUid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
