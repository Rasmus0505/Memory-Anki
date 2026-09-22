import type { MindMapDocNode, QuizNodeBindingEdge } from '@/shared/api/contracts'
import {
  getMindMapNodeUid,
  normalizeMindMapDocument,
  type MindMapDocumentInput,
} from '@/modules/content/public'

export type BoundQuestionFacts = {
  questionType: string
  marked: boolean
}

/** Subjective corner badge counts short-answer items only. Other types stay objective. */
export function isSubjectiveQuestionType(questionType: string | null | undefined): boolean {
  return String(questionType || '').trim() === 'short_answer'
}

/** One fact row per question. Marked wins if any edge says the question is marked. */
export function buildBoundQuestionFacts(
  bindings: QuizNodeBindingEdge[],
): Map<number, BoundQuestionFacts> {
  const map = new Map<number, BoundQuestionFacts>()
  for (const edge of bindings) {
    const questionId = Number(edge.question_id)
    if (!Number.isFinite(questionId)) continue
    const previous = map.get(questionId)
    map.set(questionId, {
      questionType: String(edge.question_type || previous?.questionType || ''),
      marked: Boolean(edge.marked) || Boolean(previous?.marked),
    })
  }
  return map
}

export function applyQuizQuestionMarkToBindings(
  bindings: QuizNodeBindingEdge[],
  questionId: number,
  marked: boolean,
): QuizNodeBindingEdge[] {
  let changed = false
  const next = bindings.map((edge) => {
    if (Number(edge.question_id) !== questionId || Boolean(edge.marked) === marked) return edge
    changed = true
    return { ...edge, marked }
  })
  return changed ? next : bindings
}

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
  tone: 'success' | 'info' | 'rose'
  title: string
  kind: 'objective' | 'subjective'
}

function countBadge(
  kind: NodeQuizCountBadge['kind'],
  count: number,
  hasMarked: boolean,
): NodeQuizCountBadge | null {
  if (count <= 0) return null
  const label = kind === 'objective' ? '客观' : '主观'
  return {
    text: String(count),
    tone: hasMarked ? 'rose' : kind === 'objective' ? 'success' : 'info',
    title: hasMarked
      ? `${label} ${count} 道，含标记题（含子树）`
      : `${label} ${count} 道（含子树）`,
    kind,
  }
}

/**
 * Two corner badges per node: objective (green) then subjective (sky), left to right,
 * so the objective badge stays on the bottom-right corner. Counts are full subtree
 * totals and do not shrink when a question is completed. A badge turns rose when
 * that side contains a marked question. A side with zero questions is omitted.
 */
export function buildCountBadgeByNodeUid(
  subtreeQuestions: Map<string, Set<number>>,
  facts: ReadonlyMap<number, BoundQuestionFacts> = new Map(),
): Record<string, NodeQuizCountBadge[]> {
  const map: Record<string, NodeQuizCountBadge[]> = {}
  for (const [uid, questionIds] of subtreeQuestions) {
    if (questionIds.size === 0) continue
    let objectiveCount = 0
    let subjectiveCount = 0
    let objectiveMarked = false
    let subjectiveMarked = false
    for (const questionId of questionIds) {
      const fact = facts.get(questionId)
      const subjective = isSubjectiveQuestionType(fact?.questionType)
      if (subjective) {
        subjectiveCount += 1
        if (fact?.marked) subjectiveMarked = true
      } else {
        objectiveCount += 1
        if (fact?.marked) objectiveMarked = true
      }
    }
    const badges = [
      countBadge('subjective', subjectiveCount, subjectiveMarked),
      countBadge('objective', objectiveCount, objectiveMarked),
    ].filter((badge): badge is NodeQuizCountBadge => badge != null)
    if (badges.length > 0) map[uid] = badges
  }
  return map
}

export function getQuestionIdsForNode(
  subtreeQuestions: Map<string, Set<number>>,
  nodeUid: string,
  completedQuestionIds: ReadonlySet<number> = new Set(),
  options?: {
    includeCompleted?: boolean
    /** When set, keep only that corner-badge side. Unknown types stay objective. */
    kind?: NodeQuizCountBadge['kind']
    facts?: ReadonlyMap<number, BoundQuestionFacts>
  },
): number[] {
  const all = subtreeQuestions.get(nodeUid)
  if (!all) return []
  const includeCompleted = options?.includeCompleted === true
  const ids = includeCompleted
    ? [...all]
    : [...all].filter((qid) => !completedQuestionIds.has(qid))
  const kind = options?.kind
  const filtered = kind
    ? ids.filter((questionId) => {
        const subjective = isSubjectiveQuestionType(options?.facts?.get(questionId)?.questionType)
        return kind === 'subjective' ? subjective : !subjective
      })
    : ids
  return filtered.sort((a, b) => a - b)
}

/** First unfinished id in the ordered list, or 0 when all are done / list empty. */
export function firstIncompleteQuestionIndex(
  questionIds: readonly number[],
  completedQuestionIds: ReadonlySet<number>,
): number {
  const index = questionIds.findIndex((qid) => !completedQuestionIds.has(qid))
  return index >= 0 ? index : 0
}
