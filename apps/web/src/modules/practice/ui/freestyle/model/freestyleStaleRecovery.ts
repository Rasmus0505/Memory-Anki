/**
 * Consecutive stale-card policy for the immersive feed.
 *
 * A single vanished/elsewhere-reviewed unit can be dropped and rebuilt. Unbounded
 * auto-advance is unusable: after a few consecutive drops the learner must get a
 * still screen and a recovery surface. Keys stay for the round so an aborted or
 * truncated rebuild cannot re-insert the same card+revision.
 */

export const STALE_DROP_WINDOW_MS = 2_000
export const STALE_DROP_CIRCUIT_THRESHOLD = 3
export const STALE_REBUILD_DEBOUNCE_MS = 250

export type StaleDropCircuit = {
  consecutiveCount: number
  timestamps: number[]
  open: boolean
  toasted: boolean
}

export const EMPTY_STALE_DROP_CIRCUIT: StaleDropCircuit = {
  consecutiveCount: 0,
  timestamps: [],
  open: false,
  toasted: false,
}

export type StaleDropDecision = {
  /** Drop and continue, or keep the current card on screen. */
  action: 'drop' | 'hold'
  circuitOpen: boolean
  circuitJustOpened: boolean
  shouldToast: boolean
}

export type LoadedReviewUnit = {
  id: string
  revision: number
  encounter?: { status: string } | null
}

export type UnitSessionLoadDecision =
  | { action: 'drop'; reason: 'missing_unit' }
  | { action: 'adopt'; reason: 'revision_drifted' }
  | { action: 'render'; reason: 'matched' | 'non_open_encounter' }

export function makeStaleCardKey(
  roundId: string,
  cardId: string,
  revision: unknown,
): string {
  return `${roundId}:${cardId}:${revision ?? 'unknown'}`
}

export function cardRevisionOf(card: object): number | null {
  if (!('unit_revision' in card)) return null
  const revision = (card as { unit_revision?: unknown }).unit_revision
  return typeof revision === 'number' ? revision : null
}

/**
 * Same card+revision stays out for the round. A later rebuild may re-enter the
 * card only when its unit_revision is different from the dropped key.
 */
export function isCardBlockedByStaleKey(
  staleKeys: ReadonlySet<string>,
  roundId: string,
  card: { id: string; unit_revision?: unknown },
): boolean {
  return staleKeys.has(makeStaleCardKey(roundId, card.id, cardRevisionOf(card)))
}

/**
 * Keys persist for the round. Do not delete a dropped key merely because this
 * rebuild response omitted it (abort, truncation, due-projection lag).
 */
export function retainStaleKeysAcrossRebuild(
  staleKeys: ReadonlySet<string>,
): Set<string> {
  return new Set(staleKeys)
}

export function cardReentersAfterStaleDrop(
  staleKeys: ReadonlySet<string>,
  roundId: string,
  cardId: string,
  droppedRevision: unknown,
  nextRevision: unknown,
): boolean {
  const droppedKey = makeStaleCardKey(roundId, cardId, droppedRevision)
  if (!staleKeys.has(droppedKey)) return true
  return droppedKey !== makeStaleCardKey(roundId, cardId, nextRevision)
}

export function decideStaleDrop(
  circuit: StaleDropCircuit,
  now: number,
  options?: { force?: boolean },
): { circuit: StaleDropCircuit; decision: StaleDropDecision } {
  if (options?.force) {
    return {
      circuit: EMPTY_STALE_DROP_CIRCUIT,
      decision: {
        action: 'drop',
        circuitOpen: false,
        circuitJustOpened: false,
        shouldToast: false,
      },
    }
  }
  if (circuit.open) {
    return {
      circuit,
      decision: {
        action: 'hold',
        circuitOpen: true,
        circuitJustOpened: false,
        shouldToast: false,
      },
    }
  }
  const timestamps = [
    ...circuit.timestamps.filter((stamp) => now - stamp <= STALE_DROP_WINDOW_MS),
    now,
  ]
  const consecutiveCount = circuit.consecutiveCount + 1
  const open =
    consecutiveCount >= STALE_DROP_CIRCUIT_THRESHOLD
    || timestamps.length >= STALE_DROP_CIRCUIT_THRESHOLD
  if (open) {
    return {
      circuit: {
        consecutiveCount,
        timestamps,
        open: true,
        toasted: circuit.toasted,
      },
      decision: {
        action: 'hold',
        circuitOpen: true,
        circuitJustOpened: true,
        shouldToast: false,
      },
    }
  }
  const shouldToast = !circuit.toasted
  return {
    circuit: {
      consecutiveCount,
      timestamps,
      open: false,
      toasted: circuit.toasted || shouldToast,
    },
    decision: {
      action: 'drop',
      circuitOpen: false,
      circuitJustOpened: false,
      shouldToast,
    },
  }
}

/** A working card resets the consecutive burst, but never closes an open circuit. */
export function noteStableCard(circuit: StaleDropCircuit): StaleDropCircuit {
  if (circuit.open) return circuit
  if (
    circuit.consecutiveCount === 0
    && circuit.timestamps.length === 0
    && !circuit.toasted
  ) {
    return circuit
  }
  return EMPTY_STALE_DROP_CIRCUIT
}

export function resetStaleDropCircuit(): StaleDropCircuit {
  return EMPTY_STALE_DROP_CIRCUIT
}

export function isStaleUnitError(error: unknown): boolean {
  const requestError = error as { status?: number; message?: string }
  const message = String(requestError?.message || '').toLowerCase()
  // Content-revision drift is adopted in place. Only vanished units, other-device
  // reviews (not due), and mismatched encounters trip the recovery overlay.
  return requestError?.status === 404
    || message.includes('review unit not found')
    || message.includes('not due')
    || message.includes('encounter_id belongs to another review unit')
}

/**
 * Successful session payload: adopt a drifted revision in place. Drop only when
 * the unit is gone or the encounter is missing. A non-open encounter is still
 * renderable — it is not a silent auto-jump.
 */
export function decideLoadedUnitSession(input: {
  cardUnitId: string | null | undefined
  cardRevision: number | null | undefined
  unit: LoadedReviewUnit | null | undefined
  identityStatus: string
}): UnitSessionLoadDecision {
  const unit = input.unit
  if (!unit || !input.cardUnitId || unit.id !== input.cardUnitId || !unit.encounter) {
    return { action: 'drop', reason: 'missing_unit' }
  }
  if (input.cardRevision != null && unit.revision !== input.cardRevision) {
    return { action: 'adopt', reason: 'revision_drifted' }
  }
  if (input.identityStatus !== 'closed' && unit.encounter.status !== 'open') {
    return { action: 'render', reason: 'non_open_encounter' }
  }
  return { action: 'render', reason: 'matched' }
}
