import { describe, expect, it } from 'vitest'
import { shouldRenewFreestyleEncounter, type FreestyleUnitEncounterState } from './queueState'

function encounter(overrides: Partial<FreestyleUnitEncounterState> = {}): FreestyleUnitEncounterState {
  return {
    encounterId: 'enc-1',
    roundId: 'round-1',
    unitRevision: 3,
    status: 'open',
    sessionId: 'session-1',
    selectedRating: null,
    passed: null,
    retryAfterCards: 0,
    ...overrides,
  }
}

describe('shouldRenewFreestyleEncounter', () => {
  it('reopens after an unrated swipe-away so the card can be scored again', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: null, passed: null }),
      3,
      true,
    )).toBe(true)
  })

  it('reopens a failed closed card for restudy', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: 1, passed: false }),
      3,
      true,
    )).toBe(true)
  })

  it('does not reopen a passed closed card', () => {
    expect(shouldRenewFreestyleEncounter(
      encounter({ status: 'closed', selectedRating: 3, passed: true }),
      3,
      true,
    )).toBe(false)
  })
})
