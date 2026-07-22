import { describe, expect, it } from 'vitest'
import { sentenceBounds, toggleReadingTarget } from './gapLoop'

describe('English Reading gap loop domain', () => {
  it('expands a selection to its complete sentence', () => {
    expect(sentenceBounds('First sentence. Second sentence!', 18, 24)).toEqual({
      start: 16,
      end: 32,
      quote: 'Second sentence!',
    })
  })

  it('deduplicates and caps generation targets', () => {
    const selected = Array.from({ length: 12 }, (_, index) => index + 1)
    expect(toggleReadingTarget(selected, 12, true)).toEqual(selected)
    expect(toggleReadingTarget(selected, 13, true)).toHaveLength(12)
  })
})
