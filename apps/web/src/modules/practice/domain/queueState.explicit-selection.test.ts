import { describe, expect, it } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  DEFAULT_QUEUE_STATE,
  clearMutedPalaces,
  filterMutedPalaces,
  mutePalace,
  restoreExplicitlySelectedCards,
} from './queueState'

describe('explicit freestyle palace selection', () => {
  it('clears a stale mute for an explicitly selected palace', () => {
    const state = mutePalace(mutePalace({ ...DEFAULT_QUEUE_STATE }, 40), 41)
    const reenabled = clearMutedPalaces(state, [40])
    const cards = [
      { id: 'rousseau-1', type: 'mindmap_branch', palace_id: 40 },
      { id: 'other-1', type: 'mindmap_branch', palace_id: 41 },
    ] as FreestyleCard[]

    expect(reenabled.mutedPalaceIds).toEqual([41])
    expect(filterMutedPalaces(cards, reenabled.mutedPalaceIds).map((card) => card.id)).toEqual([
      'rousseau-1',
    ])
  })

  it('does not change unrelated muted palaces or an empty selection', () => {
    const state = mutePalace({ ...DEFAULT_QUEUE_STATE }, 41)

    expect(clearMutedPalaces(state, []).mutedPalaceIds).toEqual([41])
    expect(clearMutedPalaces(state, [40]).mutedPalaceIds).toEqual([41])
  })

  it('restores explicitly selected cards removed by local stale filtering', () => {
    const response = [
      { id: 'rousseau-1', type: 'mindmap_branch', palace_id: 40 },
      { id: 'rousseau-2', type: 'mindmap_branch', palace_id: 40 },
    ] as FreestyleCard[]

    expect(
      restoreExplicitlySelectedCards(response, [], { specificPalaceIds: [40], subjectScope: 'all' })
        .map((card) => card.id),
    ).toEqual(['rousseau-1', 'rousseau-2'])
  })

  it('restores the full backend scope for a broad subject selection', () => {
    const response = [
      { id: 'english-1', type: 'mindmap_branch', palace_id: 10 },
      { id: 'rousseau-1', type: 'mindmap_branch', palace_id: 40 },
    ] as FreestyleCard[]

    expect(
      restoreExplicitlySelectedCards(response, [response[1]], {
        specificPalaceIds: [40],
        subjectScope: 'english',
      }).map((card) => card.id),
    ).toEqual(['english-1', 'rousseau-1'])
  })

  it('does not restore stale cards for an explicit palace or subject scope', () => {
    const palaceResponse = [
      { id: 'stale-palace-card', type: 'mindmap_branch', palace_id: 40 },
      { id: 'valid-palace-card', type: 'mindmap_branch', palace_id: 40 },
    ] as FreestyleCard[]
    expect(
      restoreExplicitlySelectedCards(palaceResponse, [], {
        specificPalaceIds: [40],
        subjectScope: 'all',
        excludeCardIds: ['stale-palace-card'],
      }).map((card) => card.id),
    ).toEqual(['valid-palace-card'])

    const subjectResponse = [
      { id: 'stale-english-card', type: 'mindmap_branch', palace_id: 10 },
      { id: 'kept-extra-card', type: 'mindmap_branch', palace_id: 40 },
    ] as FreestyleCard[]
    expect(
      restoreExplicitlySelectedCards(subjectResponse, [subjectResponse[1]], {
        subjectScope: 'english',
        excludeCardIds: ['stale-english-card'],
      }).map((card) => card.id),
    ).toEqual(['kept-extra-card'])
  })

  it('does not override local filtering without an explicit scope', () => {
    const response = [
      { id: 'one', type: 'mindmap_branch', palace_id: 1 },
      { id: 'two', type: 'mindmap_branch', palace_id: 2 },
    ] as FreestyleCard[]

    expect(restoreExplicitlySelectedCards(response, [response[0]])).toEqual([response[0]])
  })
})
