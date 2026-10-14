import type { MindMapEditorState } from '@/shared/api/contracts'
import {
  coerceEditorDoc,
  type EditorDoc,
  type EditorDocNode,
} from '@/shared/lib/mindmap-split-marks/splitMarks'

/**
 * Rating view of a palace: the root plus its permanent-mark nodes, nothing else.
 *
 * Opened from the 做题 「本轮最低 N」 chip. 「查看宫殿」 keeps the full map and does not
 * use this module. A node's rating is the rating of the 复习单元 it belongs to; one
 * unit has one rating (see `rerate_unit_rating` in the API).
 */

export type PermanentMarkRatingRow = {
  nodeUid: string
  text: string
  /** Null when no review unit covers this node yet. */
  unitId: string | null
  /** 1 忘记 · 2 困难 · 3 记得 · 4 轻松; null while the unit has no rating. */
  rating: number | null
  revision: number | null
}

export const RATING_WORDS: Record<number, string> = { 1: '忘记', 2: '困难', 3: '记得', 4: '轻松' }

function nodeUidOf(node: EditorDocNode): string {
  const data = node.data ?? {}
  return String(data.uid || data.memoryAnkiId || '').trim()
}

function isPermanentMark(node: EditorDocNode): boolean {
  return node.data?.permanentSplitMark === true
}

/** Keeps permanent-mark descendants, lifting them over any unmarked node in between. */
function keepPermanentMarks(node: EditorDocNode): EditorDocNode[] {
  const kept = (node.children ?? []).flatMap(keepPermanentMarks)
  if (isPermanentMark(node)) return [{ ...node, children: kept }]
  return kept
}

/**
 * The root plus permanent-mark nodes, with unmarked nodes removed. A kept node's
 * nearest kept ancestor becomes its parent. Returns null when the doc has no root.
 */
export function pruneToPermanentMarks(
  doc: EditorDoc | string | null | undefined,
): EditorDoc | null {
  const resolved = coerceEditorDoc(doc)
  if (!resolved?.root) return null
  const root = resolved.root
  return {
    ...resolved,
    root: { ...root, children: (root.children ?? []).flatMap(keepPermanentMarks) },
  }
}

/** Derived editor state for the rating view. The source state is not mutated. */
export function buildRatingEditorState(
  state: MindMapEditorState,
): MindMapEditorState {
  const pruned = pruneToPermanentMarks(state.editor_doc as EditorDoc | string | null)
  return { ...state, editor_doc: pruned ? (pruned as Record<string, unknown>) : state.editor_doc }
}

function collectMarkedNodes(node: EditorDocNode, out: EditorDocNode[]) {
  if (isPermanentMark(node)) out.push(node)
  for (const child of node.children ?? []) collectMarkedNodes(child, out)
}

/**
 * One row per permanent-mark node, in document order.
 *
 * `unitIdByNode` maps a node uid to the unit covering it (from unit-pass-states).
 * `ratings` maps a unit id to its live rating (from unit-ratings).
 */
export function buildPermanentMarkRatingRows(
  doc: EditorDoc | string | null | undefined,
  unitIdByNode: Record<string, string>,
  ratings: Record<string, { rating: number; revision: number }>,
): PermanentMarkRatingRow[] {
  const resolved = coerceEditorDoc(doc)
  if (!resolved?.root) return []
  const marked: EditorDocNode[] = []
  collectMarkedNodes(resolved.root, marked)
  return marked.map((node) => {
    const nodeUid = nodeUidOf(node)
    const unitId = unitIdByNode[nodeUid] ?? null
    const current = unitId ? ratings[unitId] : undefined
    return {
      nodeUid,
      text: String(node.data?.text ?? '').trim() || nodeUid,
      unitId,
      rating: current?.rating ?? null,
      revision: current?.revision ?? null,
    }
  })
}

/**
 * Permanent-mark uids strictly below `nodeUid`, at any depth. This is the L1 → L2
 * cascade: changing a mark also changes every mark it contains.
 */
export function descendantPermanentMarkUids(
  doc: EditorDoc | string | null | undefined,
  nodeUid: string,
): string[] {
  const resolved = coerceEditorDoc(doc)
  if (!resolved?.root) return []
  let target: EditorDocNode | null = null
  const find = (node: EditorDocNode) => {
    if (target) return
    if (nodeUidOf(node) === nodeUid) target = node
    else for (const child of node.children ?? []) find(child)
  }
  find(resolved.root)
  if (!target) return []
  const out: string[] = []
  const collect = (node: EditorDocNode, isStart: boolean) => {
    if (!isStart && isPermanentMark(node)) out.push(nodeUidOf(node))
    for (const child of node.children ?? []) collect(child, false)
  }
  collect(target, true)
  return out
}

/**
 * Map status for each rated permanent mark, read by the map's node badge
 * (`rating-forgot` / `rating-hard` / `rating-good` / `rating-easy`).
 */
export function ratingMasteryByNode(
  rows: PermanentMarkRatingRow[],
): Record<string, { status: string; manualLabel: null; masteryScore: null }> {
  const statusByRating: Record<number, string> = {
    1: 'rating-forgot',
    2: 'rating-hard',
    3: 'rating-good',
    4: 'rating-easy',
  }
  const out: Record<string, { status: string; manualLabel: null; masteryScore: null }> = {}
  for (const row of rows) {
    if (row.rating == null) continue
    out[row.nodeUid] = { status: statusByRating[row.rating], manualLabel: null, masteryScore: null }
  }
  return out
}

/** Node uid → unit id, from the unit-pass-states response (one unit covers several nodes). */
export function unitIdByNodeFromPassStates(
  items: Array<{ unit_id: string; node_uids: string[] }>,
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const item of items) {
    for (const uid of item.node_uids) map[uid] = item.unit_id
  }
  return map
}
