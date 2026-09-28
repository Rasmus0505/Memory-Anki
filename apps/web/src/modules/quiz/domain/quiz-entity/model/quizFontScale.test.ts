import { describe, expect, it } from 'vitest'
import {
  adjustQuizFontPercent,
  consumeWheelNotches,
  sanitizeQuizFontScaleSettings,
  snapQuizFontPercent,
} from './quizFontScale'

describe('quizFontScale', () => {
  it('snaps to 10% steps between 70% and 180%', () => {
    expect(snapQuizFontPercent(100)).toBe(100)
    expect(snapQuizFontPercent(114)).toBe(110)
    expect(snapQuizFontPercent(40)).toBe(70)
    expect(snapQuizFontPercent(240)).toBe(180)
    expect(snapQuizFontPercent(Number.NaN)).toBe(100)
  })

  it('steps by 10% and clamps at the ends', () => {
    expect(adjustQuizFontPercent(100, 1)).toBe(110)
    expect(adjustQuizFontPercent(100, -1)).toBe(90)
    expect(adjustQuizFontPercent(180, 3)).toBe(180)
    expect(adjustQuizFontPercent(70, -2)).toBe(70)
  })

  it('treats one upward notch as a larger font', () => {
    expect(consumeWheelNotches(0, { deltaY: -100 })).toEqual({ pending: 0, steps: 1 })
    expect(consumeWheelNotches(0, { deltaY: 100 })).toEqual({ pending: 0, steps: -1 })
    expect(consumeWheelNotches(0, { deltaY: -1, deltaMode: 1 })).toEqual({ pending: 0, steps: 1 })
  })

  it('accumulates small trackpad deltas until they make one step', () => {
    let pending = 0
    let steps = 0
    for (let index = 0; index < 9; index += 1) {
      const consumed = consumeWheelNotches(pending, { deltaY: -10 })
      pending = consumed.pending
      steps += consumed.steps
    }
    expect(steps).toBe(0)
    const last = consumeWheelNotches(pending, { deltaY: -10 })
    expect(last.steps).toBe(1)
  })

  it('drops an invalid stored preference back to 100%', () => {
    expect(sanitizeQuizFontScaleSettings(null)).toEqual({ percent: 100 })
    expect(sanitizeQuizFontScaleSettings({ percent: 125 })).toEqual({ percent: 130 })
  })
})
