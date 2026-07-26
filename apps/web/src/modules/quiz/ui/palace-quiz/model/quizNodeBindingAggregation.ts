import type { MindMapDocNode, QuizNodeBindingEdge } from '@/shared/api/contracts'
import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
} from '@/modules/content/public'

/** Direct bindings: nodeUid -> set of question ids */
export function buildDirectBindingMap(bindings: QuizNodeBindingEdge[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  for (const edge of bindings) {
    const uid = String(edge.node_uid || '').trim()
    const questionId = Number(edge.question_id)
    if (!uid || !Number.isFinite(questionId)) continue
    const set = map.get(uid) ?? new Set<number>()
    set.add(questionId)
    map.set(uid, set)
  }
  return map
}

/** Owner-palace label for a question edge (本宫 / 来自·他宫). */
export function ownerPalaceLabel(
  edge: QuizNodeBindingEdge,
  currentPalaceId: number | null | undefined,
): string {
  const ownerId = edge.question_owner_palace_id
  const ownerTitle = String(edge.question_owner_palace_title || '').trim()
  if (ownerId == null) return ownerTitle || '未知归属'
  if (currentPalaceId != null && Number(ownerId) === Number(currentPalaceId)) {
    return '本宫'
  }
  return ownerTitle ? `来自·${ownerTitle}` : `来自·宫殿${ownerId}`
}

export function groupEdgesByQuestion(
  bindings: QuizNodeBindingEdge[],
): Map<number, QuizNodeBindingEdge[]> {
  const map = new Map<number, QuizNodeBindingEdge[]>()
  for (const edge of bindings) {
    const qid = Number(edge.question_id)
    if (!Number.isFinite(qid)) continue
    const list = map.get(qid) ?? []
    list.push(edge)
    map.set(qid, list)
  }
  return map
}

/** For each node, union of own + all descendant question ids. */
export function buildSubtreeQuestionMap(
  editorDoc: MindMapDocumentInput,
  direct: Map<string, Set<number>>,
): Map<string, Set<number>> {
  const doc = normalizeMindMapDocument(editorDoc)
  const result = new Map<string, Set<number>>()

  const walk = (node: MindMapDocNode, indexPath: number[]): Set<number> => {
    const uid = getMindMapNodeUid(node, indexPath.join('-') || 'root')
    const combined = new Set<number>(direct.get(uid) ?? [])
    const children = Array.isArray(node.children) ? node.children : []
    children.forEach((child, childIndex) => {
      for (const qid of walk(child, [...indexPath, childIndex])) combined.add(qid)
    })
    result.set(uid, combined)
    return combined
  }

  walk(doc.root as MindMapDocNode, [])
  return result
}

export function buildRemainingCountByNodeUid(
  subtreeQuestions: Map<string, Set<number>>,
  completedQuestionIds: ReadonlySet<number>,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [uid, questionIds] of subtreeQuestions) {
    let remaining = 0
    for (const qid of questionIds) {
      if (!completedQuestionIds.has(qid)) remaining += 1
    }
    if (remaining > 0) counts[uid] = remaining
  }
  return counts
}

export type NodeQuizCountBadge = {
  text: string
  tone: 'success' | 'neutral'
  title: string
}

/**
 * Green badge = still has unfinished bound questions this session.
 * Gray badge = all bound questions already done this session (keep visible for review).
 * Never hide a node that still has bound questions just because they were answered.
 */
export function buildCountBadgeByNodeUid(
  subtreeQuestions: Map<string, Set<number>>,
  completedQuestionIds: ReadonlySet<number>,
): Record<string, NodeQuizCountBadge> {
  const map: Record<string, NodeQuizCountBadge> = {}
  for (const [uid, questionIds] of subtreeQuestions) {
    if (questionIds.size === 0) continue
    let remaining = 0
    for (const qid of questionIds) {
      if (!completedQuestionIds.has(qid)) remaining += 1
    }
    const total = questionIds.size
    if (remaining > 0) {
      map[uid] = {
        text: String(remaining),
        tone: 'success',
        title: `${remaining}/${total} 道未做关联题（含子树；点开可做题，完成变灰）`,
      }
    } else {
      map[uid] = {
        text: String(total),
        tone: 'neutral',
        title: `${total} 道关联题本会话已完成（点开可回顾答题）`,
      }
    }
  }
  return map
}

export function getQuestionIdsForNode(
  subtreeQuestions: Map<string, Set<number>>,
  nodeUid: string,
  completedQuestionIds: ReadonlySet<number> = new Set(),
  options?: { includeCompleted?: boolean },
): number[] {
  const all = subtreeQuestions.get(nodeUid)
  if (!all) return []
  const includeCompleted = options?.includeCompleted === true
  const ids = includeCompleted
    ? [...all]
    : [...all].filter((qid) => !completedQuestionIds.has(qid))
  return ids.sort((a, b) => a - b)
}

/** First unfinished id in the ordered list, or 0 when all are done / list empty. */
export function firstIncompleteQuestionIndex(
  questionIds: readonly number[],
  completedQuestionIds: ReadonlySet<number>,
): number {
  const index = questionIds.findIndex((qid) => !completedQuestionIds.has(qid))
  return index >= 0 ? index : 0
}
