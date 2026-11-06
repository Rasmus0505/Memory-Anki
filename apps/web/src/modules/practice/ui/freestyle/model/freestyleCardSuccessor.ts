/**
 * Find the rebuilt card that now contains the content of a vanished unit.
 *
 * A permanent-mark edit retires the old unit and merges its nodes into the
 * parent/residual unit. The queue rebuild then carries that merged unit under a
 * different `unit_id`, so an identity-only preference would drop the learner
 * onto whatever card happens to sit at the old index. Content ownership is the
 * stable link: every non-root node belongs to exactly one split unit.
 */

export interface CardContentTarget {
  palaceId?: number | null
  anchorUid?: string | null
  nodeUids?: readonly string[] | null
}

interface ContentCard {
  id: string
  type?: string
  palace_id?: number
  anchor_uid?: string
  node_uids?: readonly string[]
  occurrence_kind?: string
}

export function findSuccessorCardByContent<T extends ContentCard>(
  cards: readonly T[],
  target: CardContentTarget,
): T | null {
  const palaceId = target.palaceId
  const anchor = String(target.anchorUid || '').trim()
  const pool = cards.filter((card) => (
    card.type === 'mindmap_branch'
    && card.occurrence_kind !== 'retry'
    && !card.id.startsWith('retry:')
    && (palaceId == null || card.palace_id === palaceId)
  ))
  if (!pool.length) return null

  if (anchor) {
    // Root mark flips between a palace unit and a root residual: same anchor.
    const sameAnchor = pool.filter((card) => String(card.anchor_uid || '').trim() === anchor)
    if (sameAnchor.length === 1) return sameAnchor[0]
    // Unmarked child: its node now belongs to the parent/residual unit.
    const owners = pool.filter((card) => (card.node_uids || []).includes(anchor))
    if (owners.length === 1) return owners[0]
  }

  const oldNodes = new Set(target.nodeUids || [])
  if (!oldNodes.size) return null
  let best: T | null = null
  let bestOverlap = 0
  let ambiguous = false
  for (const card of pool) {
    const overlap = (card.node_uids || []).reduce(
      (count, uid) => count + (oldNodes.has(uid) ? 1 : 0),
      0,
    )
    if (overlap > bestOverlap) {
      best = card
      bestOverlap = overlap
      ambiguous = false
    } else if (overlap === bestOverlap && overlap > 0) {
      ambiguous = true
    }
  }
  if (!best || ambiguous) return null
  // A split is not a continuation.
  return bestOverlap * 2 >= oldNodes.size ? best : null
}
