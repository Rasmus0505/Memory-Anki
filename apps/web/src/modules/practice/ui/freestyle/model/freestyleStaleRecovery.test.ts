import { describe, expect, it } from 'vitest'
import {
  EMPTY_STALE_DROP_CIRCUIT,
  STALE_DROP_CIRCUIT_THRESHOLD,
  STALE_DROP_WINDOW_MS,
  cardReentersAfterStaleDrop,
  decideLoadedUnitSession,
  decideStaleDrop,
  isCardBlockedByStaleKey,
  isStaleUnitError,
  makeStaleCardKey,
  noteStableCard,
  resetStaleDropCircuit,
  retainStaleKeysAcrossRebuild,
} from './freestyleStaleRecovery'

describe('decideStaleDrop', () => {
  it('drops the first stale card and toasts once', () => {
    const { circuit, decision } = decideStaleDrop(EMPTY_STALE_DROP_CIRCUIT, 1_000)
    expect(decision).toEqual({
      action: 'drop',
      circuitOpen: false,
      circuitJustOpened: false,
      shouldToast: true,
    })
    expect(circuit.open).toBe(false)
    expect(circuit.toasted).toBe(true)
    expect(circuit.consecutiveCount).toBe(1)
  })

  it('drops a second consecutive card without stacking another toast', () => {
    const first = decideStaleDrop(EMPTY_STALE_DROP_CIRCUIT, 1_000)
    const second = decideStaleDrop(first.circuit, 1_200)
    expect(second.decision.action).toBe('drop')
    expect(second.decision.shouldToast).toBe(false)
    expect(second.circuit.open).toBe(false)
    expect(second.circuit.consecutiveCount).toBe(2)
  })

  it('opens the circuit on the third consecutive drop and holds that card', () => {
    let circuit = EMPTY_STALE_DROP_CIRCUIT
    for (let index = 0; index < STALE_DROP_CIRCUIT_THRESHOLD - 1; index += 1) {
      circuit = decideStaleDrop(circuit, 1_000 + index).circuit
    }
    const third = decideStaleDrop(circuit, 1_400)
    expect(third.decision).toEqual({
      action: 'hold',
      circuitOpen: true,
      circuitJustOpened: true,
      shouldToast: false,
    })
    expect(third.circuit.open).toBe(true)
  })

  it('opens the circuit for three drops inside the burst window', () => {
    let circuit = EMPTY_STALE_DROP_CIRCUIT
    circuit = decideStaleDrop(circuit, 10_000).circuit
    circuit = decideStaleDrop(circuit, 10_400).circuit
    const third = decideStaleDrop(circuit, 10_000 + STALE_DROP_WINDOW_MS - 1)
    expect(third.decision.circuitJustOpened).toBe(true)
    expect(third.decision.action).toBe('hold')
  })

  it('keeps holding after the circuit is open and never resumes auto-drop', () => {
    let circuit = EMPTY_STALE_DROP_CIRCUIT
    for (let index = 0; index < STALE_DROP_CIRCUIT_THRESHOLD; index += 1) {
      circuit = decideStaleDrop(circuit, 1_000 + index).circuit
    }
    const later = decideStaleDrop(circuit, 20_000)
    expect(later.decision.action).toBe('hold')
    expect(later.decision.circuitOpen).toBe(true)
    expect(later.decision.circuitJustOpened).toBe(false)
    expect(later.decision.shouldToast).toBe(false)
  })

  it('force-drops and closes the circuit for an explicit skip', () => {
    let circuit = EMPTY_STALE_DROP_CIRCUIT
    for (let index = 0; index < STALE_DROP_CIRCUIT_THRESHOLD; index += 1) {
      circuit = decideStaleDrop(circuit, 1_000 + index).circuit
    }
    const skipped = decideStaleDrop(circuit, 2_000, { force: true })
    expect(skipped.circuit).toEqual(EMPTY_STALE_DROP_CIRCUIT)
    expect(skipped.decision).toEqual({
      action: 'drop',
      circuitOpen: false,
      circuitJustOpened: false,
      shouldToast: false,
    })
  })
})

describe('noteStableCard', () => {
  it('clears a burst after a working card loads', () => {
    const first = decideStaleDrop(EMPTY_STALE_DROP_CIRCUIT, 1_000)
    const settled = noteStableCard(first.circuit)
    expect(settled).toEqual(EMPTY_STALE_DROP_CIRCUIT)
  })

  it('does not close an open circuit behind the learner’s back', () => {
    let circuit = EMPTY_STALE_DROP_CIRCUIT
    for (let index = 0; index < STALE_DROP_CIRCUIT_THRESHOLD; index += 1) {
      circuit = decideStaleDrop(circuit, 1_000 + index).circuit
    }
    expect(noteStableCard(circuit).open).toBe(true)
  })
})

describe('resetStaleDropCircuit', () => {
  it('returns a closed empty circuit', () => {
    expect(resetStaleDropCircuit()).toEqual(EMPTY_STALE_DROP_CIRCUIT)
  })
})

describe('stale key retention', () => {
  const roundId = 'round-1'
  const cardId = 'mindmap-unit:u1:3'

  it('keeps dropped keys even when this rebuild omitted the card', () => {
    const staleKeys = new Set([makeStaleCardKey(roundId, cardId, 3)])
    const retained = retainStaleKeysAcrossRebuild(staleKeys)
    expect(retained.has(makeStaleCardKey(roundId, cardId, 3))).toBe(true)
    expect(
      isCardBlockedByStaleKey(retained, roundId, { id: cardId, unit_revision: 3 }),
    ).toBe(true)
  })

  it('allows the same card back only with a different unit_revision', () => {
    const staleKeys = new Set([makeStaleCardKey(roundId, cardId, 3)])
    expect(cardReentersAfterStaleDrop(staleKeys, roundId, cardId, 3, 3)).toBe(false)
    expect(cardReentersAfterStaleDrop(staleKeys, roundId, cardId, 3, 4)).toBe(true)
    expect(
      isCardBlockedByStaleKey(staleKeys, roundId, { id: cardId, unit_revision: 4 }),
    ).toBe(false)
  })
})

describe('decideLoadedUnitSession', () => {
  const unit = {
    id: 'unit-1',
    revision: 4,
    encounter: { status: 'open' },
  }

  it('adopts a successful session whose unit revision drifted', () => {
    expect(decideLoadedUnitSession({
      cardUnitId: 'unit-1',
      cardRevision: 3,
      unit,
      identityStatus: 'pending',
    })).toEqual({ action: 'adopt', reason: 'revision_drifted' })
  })

  it('renders a matched open unit', () => {
    expect(decideLoadedUnitSession({
      cardUnitId: 'unit-1',
      cardRevision: 4,
      unit,
      identityStatus: 'pending',
    })).toEqual({ action: 'render', reason: 'matched' })
  })

  it('renders a successful load whose encounter is not open', () => {
    expect(decideLoadedUnitSession({
      cardUnitId: 'unit-1',
      cardRevision: 4,
      unit: { ...unit, encounter: { status: 'closed' } },
      identityStatus: 'pending',
    })).toEqual({ action: 'render', reason: 'non_open_encounter' })
  })

  it('drops when the unit is gone or belongs to someone else', () => {
    expect(decideLoadedUnitSession({
      cardUnitId: 'unit-1',
      cardRevision: 3,
      unit: null,
      identityStatus: 'pending',
    }).action).toBe('drop')
    expect(decideLoadedUnitSession({
      cardUnitId: 'unit-1',
      cardRevision: 3,
      unit: { ...unit, id: 'other-unit' },
      identityStatus: 'pending',
    }).action).toBe('drop')
    expect(decideLoadedUnitSession({
      cardUnitId: 'unit-1',
      cardRevision: 3,
      unit: { id: 'unit-1', revision: 3, encounter: null },
      identityStatus: 'pending',
    }).action).toBe('drop')
  })
})

describe('isStaleUnitError', () => {
  it('drops 404 / not due / wrong encounter only', () => {
    expect(isStaleUnitError({ status: 404 })).toBe(true)
    expect(isStaleUnitError({ message: 'Review unit not found' })).toBe(true)
    expect(isStaleUnitError({ message: 'not due' })).toBe(true)
    expect(isStaleUnitError({ message: 'encounter_id belongs to another review unit' })).toBe(true)
    expect(isStaleUnitError({ message: 'Active unit review session required' })).toBe(false)
    expect(isStaleUnitError({ message: 'review unit changed; rebuild the queue' })).toBe(false)
  })

  it('does not treat a generic load failure as stale', () => {
    expect(isStaleUnitError(new Error('temporary API failure'))).toBe(false)
    expect(isStaleUnitError({ status: 500, message: 'server exploded' })).toBe(false)
  })
})
