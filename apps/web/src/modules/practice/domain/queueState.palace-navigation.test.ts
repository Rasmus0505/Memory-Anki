import { describe, expect, it } from 'vitest'
import {
  findPreviousPalaceIndex,
  moveRemainingPalaceToTail,
} from './queueState'
import type { FreestyleCard } from '@/shared/api/contracts'

const cards = [
  { id: 'a1', type: 'mindmap_branch', palace_id: 1 },
  { id: 'a2', type: 'mindmap_branch', palace_id: 1 },
  { id: 'b1', type: 'mindmap_branch', palace_id: 2 },
  { id: 'b2', type: 'mindmap_branch', palace_id: 2 },
] as FreestyleCard[]

describe('freestyle palace navigation', () => {
  it('goes to the start of the preceding palace group', () => {
    expect(findPreviousPalaceIndex(cards, 0)).toBeNull()
    expect(findPreviousPalaceIndex(cards, 1)).toBeNull()
    expect(findPreviousPalaceIndex(cards, 2)).toBe(0)
    expect(findPreviousPalaceIndex(cards, 3)).toBe(0)
  })

  it('keeps the final palace visible when no next palace exists', () => {
    const finalPalace = cards.slice(2)
    const result = moveRemainingPalaceToTail(finalPalace, 0)

    expect(result.cards).toBe(finalPalace)
    expect(result.nextIndex).toBe(0)
    expect(result.deferredPalaceId).toBeNull()
  })
})
