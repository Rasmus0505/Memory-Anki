import { describe, expect, it } from 'vitest'
import {
  buildLetterSlots,
  buildSentenceInputText,
  clearActiveWordInState,
  completeActiveWordInState,
  countTokenInputErrors,
  createWordState,
  normalizeComparableToken,
  revealLetterInState,
} from '@/features/english/englishTypingHelpers'

describe('englishTypingHelpers', () => {
  it('normalizes typing comparisons without apostrophes and hyphens', () => {
    expect(normalizeComparableToken("Don't")).toBe('dont')
    expect(normalizeComparableToken('well-known')).toBe('wellknown')
  })

  it('counts token input mismatches with extra typed characters', () => {
    expect(countTokenInputErrors('therx', 'there')).toBe(1)
    expect(countTokenInputErrors('therexx', 'there')).toBe(2)
  })

  it('renders fixed apostrophe slots without requiring the user to type them', () => {
    const slots = buildLetterSlots("don't", 'dont')
    expect(slots.map((slot) => slot.state)).toEqual(['correct', 'correct', 'correct', 'fixed', 'correct'])
    expect(slots[3]?.char).toBe("'")
  })

  it('completes the active word with canonical token text', () => {
    const state = createWordState(["don't", 'worry'])
    state.currentWordInput = 'dont'
    state.wordInputs[0] = 'dont'

    const completed = completeActiveWordInState(state, ["don't", 'worry'])
    expect(completed.completedSentence).toBe(false)
    expect(completed.state.wordInputs[0]).toBe("don't")
    expect(completed.state.activeWordIndex).toBe(1)
    expect(completed.state.wordStatuses[1]).toBe('active')
  })

  it('reveals letters progressively and completes the word when fully revealed', () => {
    const state = createWordState(['there'])
    const firstReveal = revealLetterInState(state, ['there'], [[]])
    expect(firstReveal.state.currentWordInput).toBe('t')
    expect(firstReveal.revealComparableIndices[0]).toEqual([0])

    let nextState = firstReveal.state
    let nextReveal = firstReveal.revealComparableIndices
    for (let index = 0; index < 4; index += 1) {
      const result = revealLetterInState(nextState, ['there'], nextReveal)
      nextState = result.state
      nextReveal = result.revealComparableIndices
    }

    expect(nextState.activeWordIndex).toBe(1)
    expect(nextState.wordInputs[0]).toBe('there')
  })

  it('clears the current word input without rewinding the sentence', () => {
    const state = createWordState(['hello', 'world'])
    state.currentWordInput = 'he'
    state.wordInputs[0] = 'he'

    const cleared = clearActiveWordInState(state)
    expect(cleared.currentWordInput).toBe('')
    expect(cleared.wordInputs[0]).toBe('')
    expect(cleared.activeWordIndex).toBe(0)
  })

  it('builds final sentence text from canonical committed words', () => {
    expect(buildSentenceInputText(["don't", 'worry'])).toBe("don't worry")
  })
})
