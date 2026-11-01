import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearFreestyleOverlayWrongState,
  readFreestyleOverlayWrongState,
  replaceFreestyleOverlayWrongState,
} from './freestyleOverlayWrongState'

describe('freestyle overlay wrong state', () => {
  beforeEach(() => clearFreestyleOverlayWrongState())

  it('replaces ids and rejects an older version of the same round', () => {
    expect(replaceFreestyleOverlayWrongState({ roundId: 'r1', planVersion: 2, wrongQuestionIds: [1, 1, '2'] })).toBe(true)
    expect(replaceFreestyleOverlayWrongState({ roundId: 'r1', planVersion: 1, wrongQuestionIds: [3] })).toBe(false)
    expect([...readFreestyleOverlayWrongState().wrongQuestionIds]).toEqual([1, 2])
    expect(replaceFreestyleOverlayWrongState({ roundId: 'r1', planVersion: 3, wrongQuestionIds: [4] })).toBe(true)
    expect([...readFreestyleOverlayWrongState().wrongQuestionIds]).toEqual([4])
  })

  it('replaces old-round ids and clears by round', () => {
    replaceFreestyleOverlayWrongState({ roundId: 'old', planVersion: 1, wrongQuestionIds: [1] })
    replaceFreestyleOverlayWrongState({ roundId: 'new', planVersion: 1, wrongQuestionIds: [2] })
    expect([...readFreestyleOverlayWrongState().wrongQuestionIds]).toEqual([2])
    expect(clearFreestyleOverlayWrongState('old')).toBe(false)
    expect(clearFreestyleOverlayWrongState('new')).toBe(true)
    expect(readFreestyleOverlayWrongState().roundId).toBeNull()
  })
})
