import { describe, expect, it } from 'vitest'
import { getFireworkAccentTones, getToneSpec } from './toneProfiles'

describe('selected clear glass soundscape', () => {
  it('keeps the audition voice on editing, quiz and review paths', () => {
    for (const event of ['node_select', 'node_delete', 'quiz_answer_select', 'quiz_result_incorrect', 'card_reveal', 'grade_good', 'session_complete'] as const) {
      const tones = getToneSpec(event)
      expect(tones.length).toBeGreaterThan(0)
      expect(tones.every((tone) => tone.envelope === 'glass' && tone.type === 'sine' && !tone.endFrequency)).toBe(true)
    }
  })

  it('uses the chosen audition grade ratios rather than the former low grade scale', () => {
    const frequencies = (['grade_forget', 'grade_hard', 'grade_good', 'grade_easy'] as const).map((event) => getToneSpec(event)[0].frequency)
    expect(frequencies).toEqual([1318.5, 1318.5 * 9 / 8, 1318.5 * 5 / 4, 1318.5 * 4 / 3])
    expect(getToneSpec('grade_good')[0].gain).toBeCloseTo(0.076 * 0.82)
  })

  it('leaves the firework accents on their bright triad, which is a different layer', () => {
    const accent = getFireworkAccentTones('all_clear_ready', 0)
    expect(accent.length).toBeGreaterThan(0)
    expect(accent.every((tone) => tone.envelope === undefined)).toBe(true)
  })
})
