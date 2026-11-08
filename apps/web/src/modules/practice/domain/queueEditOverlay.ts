import type { FreestyleRoundPlanPayload } from '@/shared/api/contracts'

/**
 * Local queue edits (移出后恢复 / 排序) that a server snapshot may not show yet.
 *
 * Every queue edit writes optimistically, then waits for its round action ACK.
 * Any read that lands in between — a cold-open hydrate, a peer refresh, the ACK
 * of an earlier action — carries a plan that predates the edit. Overlaying the
 * edit keeps that read from undoing what the learner just did.
 *
 * Framework-free: the queue hook holds one `QueueEditState` in a ref and passes
 * it through these functions, so the lifetime rules live in one tested place
 * instead of three parallel refs.
 */
export interface QueueEditState {
  roundId: string
  /**
   * 每张卡最新的恢复请求。直接复用请求的 operation_id，不能只凭卡片 ID
   * 认领 ACK：恢复 → 移出 → 恢复时，第一个 ACK 不能确认第二次恢复。
   * ACK 版本及更早的快照仍需保护；严格更新的移出快照才可取代它。
   */
  restores: Map<string, { operationId: string; acknowledgedVersion: number | null }>
  /** 最新排序及其请求身份；只有这次操作自己的 ACK 才能清除。 */
  order: { operationId: string; orderIds: string[] } | null
}

export function emptyQueueEditState(roundId = ''): QueueEditState {
  return { roundId, restores: new Map(), order: null }
}

/** A different round starts with no edits: nothing of the old one may leak. */
export function queueEditsForRound(state: QueueEditState, roundId: string): QueueEditState {
  return state.roundId === roundId ? state : emptyQueueEditState(roundId)
}

export function beginRestore(
  state: QueueEditState,
  cardId: string,
  operationId: string,
): QueueEditState {
  const restores = new Map(state.restores)
  restores.set(cardId, { operationId, acknowledgedVersion: null })
  return { ...state, restores }
}

export function acknowledgeRestore(
  state: QueueEditState,
  cardId: string,
  operationId: string,
  version: number,
): QueueEditState {
  if (state.restores.get(cardId)?.operationId !== operationId) return state
  const restores = new Map(state.restores)
  restores.set(cardId, { operationId, acknowledgedVersion: version })
  return { ...state, restores }
}

/** A removal the learner makes now supersedes any earlier restore of the card. */
export function dropRestores(state: QueueEditState, cardIds: readonly string[]): QueueEditState {
  if (!cardIds.some((id) => state.restores.has(id))) return state
  const restores = new Map(state.restores)
  cardIds.forEach((id) => restores.delete(id))
  return { ...state, restores }
}

export function beginReorder(
  state: QueueEditState,
  orderIds: readonly string[],
  operationId: string,
): QueueEditState {
  return { ...state, order: { operationId, orderIds: [...orderIds] } }
}

/** 相同内容不等于同一次操作（A → B → A）；只按请求身份清除。 */
export function acknowledgeReorder(
  state: QueueEditState,
  operationId: string,
): QueueEditState {
  return state.order?.operationId === operationId ? { ...state, order: null } : state
}

/** 采用另一轮的快照时，旧轮的恢复标记不能进入它的账本。 */
export function restoringIds(state: QueueEditState, roundId: string): string[] {
  return state.roundId === roundId ? [...state.restores.keys()] : []
}

export function isRestoring(state: QueueEditState, cardId: string): boolean {
  return state.restores.has(cardId)
}

/**
 * Rows a reorder may move, by the server's own rule
 * (`round_plan_queue.py::reorder_unscored_cards`). The two sides read the same
 * golden cases (`queue_order_cases.json`), so a lock added on one side only
 * fails a parity test.
 */
function lockedServerIds(plan: FreestyleRoundPlanPayload): Set<string> {
  const locked = new Set<string>([
    ...plan.completed_ids,
    ...plan.excluded_ids,
    ...(plan.compressed_ids ?? []),
    ...Object.keys(plan.bedtime_ratings ?? {}),
  ])
  Object.entries(plan.encounters ?? {}).forEach(([id, encounter]) => {
    const rating = Number(encounter?.rating)
    if (rating === 1 || rating === 2 || rating === 3 || rating === 4) locked.add(id)
  })
  plan.original_cards.forEach((card) => {
    if (card.bedtime || card.palace_pass) locked.add(card.card_id)
  })
  ;(plan.occurrences ?? []).forEach((occurrence) => {
    if (occurrence.occurrence_id) locked.add(occurrence.occurrence_id)
    if (
      occurrence.source_card_id
      && (occurrence.status === 'pending' || occurrence.status === 'inserted')
    ) {
      locked.add(occurrence.source_card_id)
    }
  })
  return locked
}

/** Reorder unscored rows of a server snapshot, keeping every handled row in its slot. */
export function reorderServerPresentedIds(
  plan: FreestyleRoundPlanPayload,
  orderIds: readonly string[],
): string[] {
  const presented = plan.presented_ids
  const originalIds = new Set(plan.original_cards.map((card) => card.card_id))
  const locked = lockedServerIds(plan)
  const movable = presented.filter((id) => originalIds.has(id) && !locked.has(id))
  const allowed = new Set(movable)
  const requested: string[] = []
  const seen = new Set<string>()
  orderIds.forEach((raw) => {
    const id = String(raw ?? '').trim()
    if (!id || seen.has(id) || !allowed.has(id)) return
    seen.add(id)
    requested.push(id)
  })
  movable.forEach((id) => {
    if (!seen.has(id)) requested.push(id)
  })
  let cursor = 0
  return presented.map((id) => (allowed.has(id) ? requested[cursor++] : id))
}

/**
 * Overlay pending local edits on a server snapshot.
 *
 * Returns the plan to adopt and the edit state after reading it: a restore that
 * a strictly newer snapshot has excluded again is dropped from the state, so the
 * caller stops protecting it.
 */
export function overlayQueueEdits(
  state: QueueEditState,
  plan: FreestyleRoundPlanPayload,
  roundId: string,
  version: number,
): { plan: FreestyleRoundPlanPayload; state: QueueEditState } {
  if (state.roundId !== roundId) return { plan, state }
  let next = state
  for (const id of plan.excluded_ids) {
    const ackedAt = next.restores.get(id)?.acknowledgedVersion
    if (ackedAt != null && version > ackedAt) next = dropRestores(next, [id])
  }
  const excluded = next.restores.size
    ? plan.excluded_ids.filter((id) => !next.restores.has(id))
    : plan.excluded_ids
  // 恢复先解除旧快照的移出锁，再应用后续排序；否则刚恢复的卡会留在旧槽位。
  const restoredPlan = excluded === plan.excluded_ids ? plan : { ...plan, excluded_ids: excluded }
  const presented = next.order
    ? reorderServerPresentedIds(restoredPlan, next.order.orderIds)
    : plan.presented_ids
  if (presented === plan.presented_ids && excluded === plan.excluded_ids) {
    return { plan, state: next }
  }
  return {
    plan: { ...plan, presented_ids: presented, excluded_ids: excluded },
    state: next,
  }
}
