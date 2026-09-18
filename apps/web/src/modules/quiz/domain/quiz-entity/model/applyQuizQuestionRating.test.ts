import { describe, expect, it } from 'vitest'
import { isFirstQuizRating } from './applyQuizQuestionRating'

describe('isFirstQuizRating', () => {
  it('treats a missing rating as the first score', () => {
    expect(isFirstQuizRating(undefined)).toBe(true)
    expect(isFirstQuizRating(0)).toBe(true)
    expect(isFirstQuizRating(3)).toBe(false)
  })
})
