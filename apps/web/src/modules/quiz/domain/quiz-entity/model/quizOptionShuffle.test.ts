import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS,
  sanitizeQuizOptionShuffleSettings,
  shouldAutoShuffleQuizOptions,
  withRestoredQuizOptions,
  withShuffledQuizOptions,
} from './quizOptionShuffle'

const options = [
  { id: 'A', text: '甲' },
  { id: 'B', text: '乙' },
  { id: 'C', text: '丙' },
  { id: 'D', text: '丁' },
]
const empty = { originalOrder: [], currentOrder: [], shuffled: false }
const idOf = (option: { id: string }) => option.id

describe('quiz option shuffle', () => {
  it('defaults to enabled with a five-second threshold', () => {
    expect(DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS).toEqual({ enabled: true, thresholdSeconds: 5 })
    expect(sanitizeQuizOptionShuffleSettings({ enabled: false, thresholdSeconds: -1 })).toEqual({ enabled: false, thresholdSeconds: 0 })
    expect(sanitizeQuizOptionShuffleSettings({ thresholdSeconds: NaN })).toEqual(DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS)
  })

  it('uses a strict less-than threshold', () => {
    expect(shouldAutoShuffleQuizOptions(4999, DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS)).toBe(true)
    expect(shouldAutoShuffleQuizOptions(5000, DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS)).toBe(false)
    expect(shouldAutoShuffleQuizOptions(null, DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS)).toBe(false)
    expect(shouldAutoShuffleQuizOptions(1, { enabled: false, thresholdSeconds: 5 })).toBe(false)
  })

  it('keeps the first baseline across repeated shuffles and restores it', () => {
    const first = withShuffledQuizOptions(options, empty, idOf, () => 0)
    const second = withShuffledQuizOptions(options, first, idOf, () => 0)
    expect(first.originalOrder).toEqual(['A', 'B', 'C', 'D'])
    expect(second.originalOrder).toEqual(['A', 'B', 'C', 'D'])
    expect(second.currentOrder).not.toEqual(first.currentOrder)
    expect(second.shuffled).toBe(true)
    const restored = withRestoredQuizOptions(second)
    expect(restored.currentOrder).toEqual(['A', 'B', 'C', 'D'])
    expect(restored.shuffled).toBe(false)
  })

  it('does not mutate original options and ignores a single option', () => {
    const state = withShuffledQuizOptions(options, empty, idOf, () => 0)
    expect(options.map((option) => option.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(state.currentOrder).not.toEqual(options.map(idOf))
    expect(withShuffledQuizOptions(options.slice(0, 1), empty, idOf)).toBe(empty)
  })
})
