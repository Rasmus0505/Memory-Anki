import { describe, expect, it } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  findPalaceJumpTarget,
  resolvePalaceDirectoryClick,
} from './freestyle-palace-directory'

function card(id: string, palaceId: number): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    palace_id: palaceId,
    palace_title: `P${palaceId}`,
    unit_id: `unit-${id}`,
    unit_revision: 1,
    label: id,
  } as unknown as FreestyleCard
}

describe('palace directory click resolution', () => {
  it('ignores the palace already on screen', () => {
    expect(resolvePalaceDirectoryClick({
      palaceId: 7,
      currentPalaceId: 7,
      reviewPalaceId: null,
    })).toEqual({ kind: 'ignore' })
  })

  it('stays inside the palace review route', () => {
    expect(resolvePalaceDirectoryClick({
      palaceId: 9,
      currentPalaceId: 7,
      reviewPalaceId: 7,
    })).toEqual({ kind: 'review', palaceId: 9 })
  })

  it('inspects the live round instead of rewriting its scope', () => {
    expect(resolvePalaceDirectoryClick({
      palaceId: 9,
      currentPalaceId: 7,
      reviewPalaceId: null,
    })).toEqual({ kind: 'inspect' })
  })
})

describe('palace jump target', () => {
  const cards = [card('a', 1), card('b', 1), card('c', 2)]

  it('lands on the palace\'s first unscored card in queue order', () => {
    expect(findPalaceJumpTarget(cards, 1, new Set(['a']))).toEqual({
      cardId: 'b',
      complete: false,
    })
  })

  it('falls back to the last card when every card is scored', () => {
    expect(findPalaceJumpTarget(cards, 1, new Set(['a', 'b']))).toEqual({
      cardId: 'b',
      complete: true,
    })
  })

  it('returns null when the palace has no card in this round', () => {
    expect(findPalaceJumpTarget(cards, 3, new Set())).toBeNull()
  })
})
