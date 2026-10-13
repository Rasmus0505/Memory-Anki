import { describe, expect, it } from 'vitest'
import { advanceNewUnitsBanner, INITIAL_NEW_UNITS_BANNER_TRACKER } from './newUnitsFinished'

describe('advanceNewUnitsBanner', () => {
  it('shows once when the last pending new unit clears within the same round', () => {
    let state = advanceNewUnitsBanner(INITIAL_NEW_UNITS_BANNER_TRACKER, 'r1', 2)
    expect(state.show).toBe(false)
    state = advanceNewUnitsBanner(state.tracker, 'r1', 1)
    expect(state.show).toBe(false)
    state = advanceNewUnitsBanner(state.tracker, 'r1', 0)
    expect(state.show).toBe(true)
    state = advanceNewUnitsBanner(state.tracker, 'r1', 0)
    expect(state.show).toBe(false)
  })

  it('does not fire for a round that opens with no new units left', () => {
    const state = advanceNewUnitsBanner(INITIAL_NEW_UNITS_BANNER_TRACKER, 'r1', 0)
    expect(state.show).toBe(false)
  })

  it('resets when a new round starts, so the next round can show its own banner', () => {
    let state = advanceNewUnitsBanner(INITIAL_NEW_UNITS_BANNER_TRACKER, 'r1', 1)
    state = advanceNewUnitsBanner(state.tracker, 'r1', 0)
    expect(state.show).toBe(true)
    state = advanceNewUnitsBanner(state.tracker, 'r2', 3)
    expect(state.show).toBe(false)
    state = advanceNewUnitsBanner(state.tracker, 'r2', 0)
    expect(state.show).toBe(true)
  })
})
