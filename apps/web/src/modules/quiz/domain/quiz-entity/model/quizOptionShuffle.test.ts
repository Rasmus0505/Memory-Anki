import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS,
  sanitizeQuizOptionShuffleSettings,
  withShuffledQuizOptions,
} from './quizOptionShuffle'

const options = [
  { id: 'A', text: '甲' },
  { id: 'B', text: '乙' },
  { id: 'C', text: '丙' },
  { id: 'D', text: '丁' },
]
const empty = { currentOrder: [], shuffled: false }
const idOf = (option: { id: string }) => option.id

describe('quiz option shuffle', () => {
  it('defaults to enabled and sanitizes old threshold entries', () => {
    expect(DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS).toEqual({ enabled: true })
    expect(sanitizeQuizOptionShuffleSettings({ enabled: false })).toEqual({ enabled: false })
    // Entries written before the threshold was removed still load.
    expect(sanitizeQuizOptionShuffleSettings({ enabled: false, thresholdSeconds: 5 })).toEqual({ enabled: false })
    expect(sanitizeQuizOptionShuffleSettings({ thresholdSeconds: NaN })).toEqual(DEFAULT_QUIZ_OPTION_SHUFFLE_SETTINGS)
  })

  it('keeps shuffling on every call without mutating the previous order', () => {
    const first = withShuffledQuizOptions(options, empty, idOf, () => 0)
    const second = withShuffledQuizOptions(options, first, idOf, () => 0)
    expect(first.currentOrder).toEqual(['B', 'C', 'D', 'A'])
    expect(second.currentOrder).not.toEqual(first.currentOrder)
    expect(second.shuffled).toBe(true)
  })

  it('does not mutate original options and ignores a single option', () => {
    const state = withShuffledQuizOptions(options, empty, idOf, () => 0)
    expect(options.map((option) => option.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(state.currentOrder).not.toEqual(options.map(idOf))
    expect(withShuffledQuizOptions(options.slice(0, 1), empty, idOf)).toBe(empty)
  })
})
