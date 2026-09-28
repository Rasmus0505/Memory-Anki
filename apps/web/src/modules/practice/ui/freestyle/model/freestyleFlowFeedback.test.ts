import { describe, expect, it } from 'vitest'
import {
  FLOW_PALACE_CLEARED_SIGNAL,
  FLOW_REVEAL_SIGNAL,
  comboMilestoneIndex,
  flowRatingSignal,
} from './freestyleFlowFeedback'

describe('freestyleFlowFeedback', () => {
  it('answers a reveal with sound only, because the card already changed visibly', () => {
    expect(FLOW_REVEAL_SIGNAL.audioEvent).toBe('card_reveal')
    expect(FLOW_REVEAL_SIGNAL.breath).toBeNull()
  })

  it('gives every grade its own voice, rising with confidence', () => {
    const events = ([1, 2, 3, 4] as const).map((rating) => flowRatingSignal(rating, rating >= 3).audioEvent)
    expect(events).toEqual(['node_select', 'text_commit', 'field_commit', 'segment_action'])
    expect(new Set(events).size).toBe(4)
  })

  it('never uses a miss sound for a weak rate, so failure anxiety is not manufactured', () => {
    for (const rating of [1, 2] as const) {
      const signal = flowRatingSignal(rating, false)
      expect(signal.audioEvent).not.toBe('quiz_result_incorrect')
      expect(signal.audioEvent).not.toBe('save_error')
      expect(signal.breath).toBe('note')
    }
  })

  it('lets the server pass verdict decide the breath', () => {
    expect(flowRatingSignal(3, true).breath).toBe('affirm')
    expect(flowRatingSignal(2, true).breath).toBe('affirm')
    expect(flowRatingSignal(3, false).breath).toBe('note')
  })

  it('maps each grade to a card gesture and haptic', () => {
    expect(flowRatingSignal(1, false)).toMatchObject({ reaction: 'sink', haptic: 'soft-fail' })
    expect(flowRatingSignal(2, false)).toMatchObject({ reaction: 'wobble', haptic: 'select' })
    expect(flowRatingSignal(3, true)).toMatchObject({ reaction: 'lift', haptic: 'success' })
    expect(flowRatingSignal(4, true)).toMatchObject({ reaction: 'fling', haptic: 'success' })
  })

  it('only 忘记 ends a streak; it resets quietly rather than punishing', () => {
    expect(flowRatingSignal(1, false).keepsCombo).toBe(false)
    for (const rating of [2, 3, 4] as const) {
      expect(flowRatingSignal(rating, rating >= 3).keepsCombo).toBe(true)
    }
  })

  it('fires a combo milestone only on the exact step', () => {
    const steps = [4, 8, 12, 20]
    expect(comboMilestoneIndex(4, steps)).toBe(0)
    expect(comboMilestoneIndex(20, steps)).toBe(3)
    expect(comboMilestoneIndex(5, steps)).toBeNull()
    expect(comboMilestoneIndex(0, steps)).toBeNull()
  })

  it('marks a palace chapter with a different tone than a single rate', () => {
    expect(FLOW_PALACE_CLEARED_SIGNAL.audioEvent).toBe('all_clear_ready')
    expect(FLOW_PALACE_CLEARED_SIGNAL.audioEvent).not.toBe('field_commit')
    expect(FLOW_PALACE_CLEARED_SIGNAL.breath).toBe('affirm')
  })
})
