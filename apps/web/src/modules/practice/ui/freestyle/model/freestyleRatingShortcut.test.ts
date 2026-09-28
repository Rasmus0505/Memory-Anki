import { describe, expect, it } from 'vitest'
import {
  getFreestyleRatingShortcut,
  isFreestyleRemoveFromQueueShortcut,
} from './freestyleRatingShortcut'

describe('getFreestyleRatingShortcut', () => {
  it('maps 1-4 to the four unit ratings', () => {
    expect(getFreestyleRatingShortcut('1')).toBe(1)
    expect(getFreestyleRatingShortcut('2')).toBe(2)
    expect(getFreestyleRatingShortcut('3')).toBe(3)
    expect(getFreestyleRatingShortcut('4')).toBe(4)
  })

  it('ignores every other key', () => {
    for (const key of ['0', '5', 'a', 'Enter', ' ', 'ArrowDown', '']) {
      expect(getFreestyleRatingShortcut(key)).toBeNull()
    }
  })

  it('reserves 5 for removing the current card from this round', () => {
    expect(isFreestyleRemoveFromQueueShortcut('5')).toBe(true)
    expect(isFreestyleRemoveFromQueueShortcut('1')).toBe(false)
  })
})
