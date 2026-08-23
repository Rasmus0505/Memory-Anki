import { describe, expect, it } from 'vitest'
import {
  FLOW_PALACE_CLEARED_SIGNAL,
  FLOW_REVEAL_SIGNAL,
  flowRatingSignal,
} from './freestyleFlowFeedback'

describe('freestyleFlowFeedback', () => {
  it('answers a reveal with sound only, because the card already changed visibly', () => {
    expect(FLOW_REVEAL_SIGNAL.audioEvent).toBe('card_reveal')
    expect(FLOW_REVEAL_SIGNAL.breath).toBeNull()
  })

  it('confirms a passing rate as committed', () => {
    expect(flowRatingSignal(3, true)).toEqual({ audioEvent: 'field_commit', breath: 'affirm' })
    expect(flowRatingSignal(4, true)).toEqual({ audioEvent: 'field_commit', breath: 'affirm' })
  })

  it('never uses a miss sound for a weak rate, so failure anxiety is not manufactured', () => {
    for (const rating of [1, 2] as const) {
      const signal = flowRatingSignal(rating, false)
      expect(signal.audioEvent).not.toBe('quiz_result_incorrect')
      expect(signal.audioEvent).toBe('node_select')
      expect(signal.breath).toBe('note')
    }
  })

  it('marks a palace chapter with a different tone than a single rate', () => {
    expect(FLOW_PALACE_CLEARED_SIGNAL.audioEvent).toBe('all_clear_ready')
    expect(FLOW_PALACE_CLEARED_SIGNAL.audioEvent).not.toBe('field_commit')
    expect(FLOW_PALACE_CLEARED_SIGNAL.breath).toBe('affirm')
  })

  it('gives every rate some immediate answer — silence was the original defect', () => {
    const signals = [
      flowRatingSignal(1, false),
      flowRatingSignal(2, false),
      flowRatingSignal(3, true),
      flowRatingSignal(4, true),
    ]
    expect(signals.every((signal) => Boolean(signal.audioEvent))).toBe(true)
  })
})
