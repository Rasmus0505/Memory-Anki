export interface ParentCharge {
  done: number
  total: number
  mastered: boolean
}

export type ChargePhase = 'hidden' | 'revealed' | 'other'

export interface ChargeNode {
  id: string
  parentId: string | null
  phase: ChargePhase
}

export interface ChargeBurst {
  parentId: string
  originId: string
  done: number
  total: number
  label: string
  mastered: boolean
}

export interface ChargeBurstPlan {
  bursts: ChargeBurst[]
  /** True when at least one parent just filled. One freeze covers the whole batch. */
  freeze: boolean
}

export function chargeEqual(left: ParentCharge | null | undefined, right: ParentCharge | null | undefined) {
  if (left == null || right == null) return left == null && right == null
  return left.done === right.done && left.total === right.total && left.mastered === right.mastered
}

/** Direct children only. Deal (hidden) raises the total; crack (revealed) raises done. */
export function planParentCharges(nodes: readonly ChargeNode[]): Map<string, ParentCharge> {
  const buckets = new Map<string, { done: number; total: number }>()
  for (const node of nodes) {
    if (!node.parentId || node.phase === 'other') continue
    const bucket = buckets.get(node.parentId) ?? { done: 0, total: 0 }
    bucket.total += 1
    if (node.phase === 'revealed') bucket.done += 1
    buckets.set(node.parentId, bucket)
  }
  const charges = new Map<string, ParentCharge>()
  for (const [id, bucket] of buckets) {
    if (bucket.total <= 0) continue
    charges.set(id, {
      done: bucket.done,
      total: bucket.total,
      mastered: bucket.done === bucket.total,
    })
  }
  return charges
}

/**
 * One orb per cracked card, flying to its direct parent. Mastered means every
 * direct flip-session child is revealed.
 */
export function planChargeBurst(input: {
  flips: readonly string[]
  parentOf: ReadonlyMap<string, string>
  phaseOf: ReadonlyMap<string, ChargePhase>
}): ChargeBurstPlan {  const children = new Map<string, string[]>()
  for (const [childId, parentId] of input.parentOf) {
    const phase = input.phaseOf.get(childId)
    if (phase !== 'hidden' && phase !== 'revealed') continue
    const list = children.get(parentId) ?? []
    list.push(childId)
    children.set(parentId, list)
  }

  const bursts: ChargeBurst[] = []
  for (const originId of input.flips) {
    const parentId = input.parentOf.get(originId)
    if (!parentId) continue
    const kids = children.get(parentId) ?? []
    if (kids.length === 0) continue
    const done = kids.filter((id) => input.phaseOf.get(id) === 'revealed').length
    const mastered = done === kids.length
    bursts.push({
      parentId,
      originId,
      done,
      total: kids.length,
      label: `${done}/${kids.length}`,
      mastered,
    })
  }
  return { bursts, freeze: bursts.some((burst) => burst.mastered) }
}

export interface RevealTransition {
  /** Cards that just became revealed in this commit, in document order. */
  newlyRevealed: string[]
  /** Cards that just lost their revealed flag (folded back). */
  folded: string[]
  /**
   * Per newly-revealed card, the batch stagger slot to apply. Simultaneous
   * reveals keep the lab's 45 ms cadence instead of firing as one wall of sound.
   */
  delayMsById: Map<string, number>
  /** The handled/marker set to persist for the next commit. */
  handled: Set<string>
  /** The revealed set to persist for the next commit. */
  previous: Set<string>
}

/**
 * Decide which reveal/fold feedback a commit owes.
 *
 * The first commit for a document — mount, or a switch to another graph — is a
 * **silent hydration**: existing progress is only recorded, never replayed.
 * Otherwise opening an already-flipped palace would re-run the whole crack,
 * orb and reward sequence for cards the learner saw long ago.
 */
export function planRevealTransitions(input: {
  revealed: ReadonlySet<string>
  handled: ReadonlySet<string>
  previous: ReadonlySet<string>
  hydrated: boolean
  sameGraph: boolean
  staggerMs: number
}): RevealTransition {
  const { revealed, handled, previous, hydrated, sameGraph, staggerMs } = input
  if (!hydrated || !sameGraph) {
    return {
      newlyRevealed: [],
      folded: [],
      delayMsById: new Map(),
      handled: new Set(revealed),
      previous: new Set(revealed),
    }
  }
  const folded = [...previous].filter((id) => !revealed.has(id))
  const newlyRevealed = [...revealed].filter((id) => !handled.has(id))
  const delayMsById = new Map<string, number>()
  newlyRevealed.forEach((id, index) => delayMsById.set(id, index * staggerMs))
  return {
    newlyRevealed,
    folded,
    delayMsById,
    handled: new Set([...handled, ...newlyRevealed].filter((id) => revealed.has(id))),
    previous: new Set(revealed),
  }
}
