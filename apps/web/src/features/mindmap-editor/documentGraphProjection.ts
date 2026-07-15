import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapEditorState,
  MindMapHostSegmentRangeDraft,
  MindMapHostSegmentSummary,
} from '@/shared/api/contracts'
import {
  addMindMapChild,
  addMindMapChildWithResult,
  addMindMapSibling,
  addMindMapSiblingWithResult,
  canMoveMindMapNode,
  countMindMapSubtree,
  deleteMindMapNode,
  deleteMindMapNodeOnly,
  editMindMapNode,
  getMindMapNodeText,
  getMindMapNodeUid,
  normalizeMindMapDocument,
  parseMindMapDocument,
  reparentMindMapNode,
  reorderMindMapNode,
  moveMindMapNode,
  selectMindMapNode,
} from '@/entities/mindmap-document'
import type { GraphData, MindMapNode } from '@/shared/ui/mindmap-canvas/adapter'
import { BRANCH_COLORS } from '@/shared/ui/mindmap-canvas/branchColors'

type RevealState = 'hidden' | 'placeholder' | 'revealed'

export interface EditorDocGraphOptions {
  segments?: MindMapHostSegmentSummary[]
  activeSegmentId?: number | null
  segmentColorMode?: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft?: MindMapHostSegmentRangeDraft
  revealMap?: Record<string, RevealState>
  readonly?: boolean
  highlightedNodeUids?: string[]
  masteryByNodeUid?: Record<string, { status: string; manualLabel?: string | null }>
}

export interface EditorDocCreateResult {
  editorDoc: MindMapDoc
  nodeUid: string | null
}

export function parseEditorDoc(value: MindMapEditorState['editor_doc']): MindMapDoc {
  return parseMindMapDocument(value) as MindMapDoc
}

export function normalizeEditorDocTree(value: MindMapEditorState['editor_doc']): MindMapDoc {
  return normalizeMindMapDocument(value) as MindMapDoc
}

export function editorDocToGraph(
  editorDoc: MindMapEditorState['editor_doc'],
  options: EditorDocGraphOptions = {},
): GraphData {
  const doc = normalizeMindMapDocument(editorDoc)
  const nodes: MindMapNode[] = []
  const edges: GraphData['edges'] = []
  const segmentByNodeUid = buildSegmentByNodeUid(options.segments ?? [])
  const rangeSelected = new Set(options.segmentRangeDraft?.selectedNodeUids ?? [])
  const highlightedSet = new Set(options.highlightedNodeUids ?? [])

  const walk = (node: MindMapDocNode, parentId: string | null, depth: number, indexPath: number[]) => {
    const uid = getMindMapNodeUid(node, indexPath.join('-') || 'root')
    const text = getMindMapNodeText(node) || (depth === 0 ? '未命名导图' : '未命名知识点')
    const segment = segmentByNodeUid.get(uid) ?? null
    const activeSegment = segment != null && segment.id === options.activeSegmentId
    const segmentVisible = segment != null && (options.segmentColorMode !== 'active-only' || activeSegment)
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
        visual: buildNodeVisual({
          revealState,
          borderColor: rangeSelected.has(uid) ? '#0ea5e9' : segmentVisible ? segment?.color : null,
          muted: options.segmentColorMode === 'active-only' && segment != null && !activeSegment,
          secondaryMarked: false,
          highlighted: highlightedSet.has(uid),
          mastery: options.masteryByNodeUid?.[uid],
        }),
      },
    })
    if (parentId) {
      const renderStyle = options.revealMap ? getRuntimeEdgeRenderStyle(node.data) : undefined
      edges.push({ id: `${parentId}->${uid}`, source: parentId, target: uid, type: 'parent-child', renderStyle })
    }
    ;(Array.isArray(node.children) ? node.children : []).forEach((child, childIndex) =>
      walk(child, uid, depth + 1, [...indexPath, childIndex]),
    )
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

export const buildSelectionFromDoc = selectMindMapNode
export const editEditorDocNode = editMindMapNode
export const addEditorDocChild = addMindMapChild
export const addEditorDocSibling = addMindMapSibling
export const deleteEditorDocNode = deleteMindMapNode
export const deleteEditorDocNodeOnly = deleteMindMapNodeOnly
export const countEditorDocSubtree = countMindMapSubtree
export const reparentEditorDocNode = reparentMindMapNode
export const reorderEditorDocNode = reorderMindMapNode
export const moveEditorDocNode = moveMindMapNode
export const canMoveEditorDocNode = canMoveMindMapNode

export function addEditorDocChildWithResult(
  editorDoc: MindMapEditorState['editor_doc'],
  parentUid: string,
): EditorDocCreateResult {
  const result = addMindMapChildWithResult(editorDoc, parentUid)
  return { editorDoc: result.document as MindMapDoc, nodeUid: result.nodeUid }
}

export function addEditorDocSiblingWithResult(
  editorDoc: MindMapEditorState['editor_doc'],
  nodeUid: string,
): EditorDocCreateResult {
  const result = addMindMapSiblingWithResult(editorDoc, nodeUid)
  return { editorDoc: result.document as MindMapDoc, nodeUid: result.nodeUid }
}

function buildSegmentByNodeUid(segments: MindMapHostSegmentSummary[]) {
  const map = new Map<string, MindMapHostSegmentSummary>()
  segments.forEach((segment) => segment.node_uids.forEach((uid) => map.set(uid, segment)))
  return map
}

function buildNodeVisual(options: {
  revealState?: RevealState
  borderColor: string | null | undefined
  muted: boolean
  secondaryMarked: boolean
  highlighted: boolean
  mastery?: { status: string; manualLabel?: string | null }
}) {
  const masteryStatus = options.mastery?.status ?? ''
  const manualLabel = options.mastery?.manualLabel ?? ''
  const ratingBadge = {
    'rating-forgot': { tone: 'danger' as const, title: '忘记' },
    'rating-hard': { tone: 'warning' as const, title: '困难' },
    'rating-good': { tone: 'info' as const, title: '记得' },
    'rating-easy': { tone: 'success' as const, title: '轻松' },
  }[masteryStatus as 'rating-forgot' | 'rating-hard' | 'rating-good' | 'rating-easy']
  const badge = ratingBadge ?? (manualLabel === 'weak' || masteryStatus === 'weak'
    ? { tone: 'danger' as const, title: manualLabel === 'weak' ? '手动标记薄弱' : masteryStatus }
    : manualLabel === 'mastered' || masteryStatus === 'stable'
      ? { tone: 'success' as const, title: manualLabel === 'mastered' ? '手动标记已掌握' : masteryStatus }
      : masteryStatus === 'reinforce'
        ? { tone: 'warning' as const, title: masteryStatus }
        : masteryStatus
          ? { tone: 'neutral' as const, title: masteryStatus }
          : null)
  return {
    concealText: options.revealState === 'hidden',
    placeholder: options.revealState === 'placeholder',
    borderColor: options.borderColor ?? null,
    outlineTones: [
      ...(options.secondaryMarked ? ['info' as const] : []),
    ],
    highlighted: options.highlighted,
    muted: options.muted,
    badge,
  }
}
