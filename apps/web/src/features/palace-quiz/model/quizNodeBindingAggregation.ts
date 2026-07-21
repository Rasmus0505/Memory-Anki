import type { MindMapDocNode, QuizNodeBindingEdge } from '@/shared/api/contracts'
import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
} from '@/entities/mindmap-document'

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

export function getQuestionIdsForNode(
  subtreeQuestions: Map<string, Set<number>>,
  nodeUid: string,
  completedQuestionIds: ReadonlySet<number> = new Set(),
): number[] {
  const all = subtreeQuestions.get(nodeUid)
  if (!all) return []
  return [...all].filter((qid) => !completedQuestionIds.has(qid)).sort((a, b) => a - b)
}
