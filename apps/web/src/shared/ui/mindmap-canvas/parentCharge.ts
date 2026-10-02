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
 * One orb per parent touched by this crack batch. Mastered means every direct
 * flip-session child is revealed and this batch cracked at least one of them.
 */
export function planChargeBurst(input: {
  flips: readonly string[]
  parentOf: ReadonlyMap<string, string>
  phaseOf: ReadonlyMap<string, ChargePhase>
}): ChargeBurstPlan {
  const children = new Map<string, string[]>()
  for (const [childId, parentId] of input.parentOf) {
    const phase = input.phaseOf.get(childId)
    if (phase !== 'hidden' && phase !== 'revealed') continue
    const list = children.get(parentId) ?? []
    list.push(childId)
    children.set(parentId, list)
  }

  const originByParent = new Map<string, string>()
  for (const id of input.flips) {
    const parentId = input.parentOf.get(id)
    if (!parentId || originByParent.has(parentId)) continue
    originByParent.set(parentId, id)
  }

  const bursts: ChargeBurst[] = []
  for (const [parentId, originId] of originByParent) {
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
