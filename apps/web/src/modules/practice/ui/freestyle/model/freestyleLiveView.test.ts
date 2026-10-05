import { describe, expect, it } from 'vitest'
import { decodeFreestyleLiveView, isWeakerLiveRating, serializeFreestyleLiveView } from './freestyleLiveView'

describe('decodeFreestyleLiveView', () => {
  it('defaults the new viewport fields for a legacy payload', () => {
    const view = decodeFreestyleLiveView({
      palaceId: 7,
      currentCardId: 'card-2',
      currentIndex: 1,
      queueCardIds: ['card-1', 'card-2'],
      roundComplete: true,
    })
    expect(view).toMatchObject({
      currentCardId: 'card-2',
      currentIndex: 1,
      visualIndex: 1,
      viewingCompleteSlot: false,
      roundComplete: true,
      roundId: '',
      planVersion: 0,
    })
  })

  it.each([
    { visualIndex: 2, viewingCompleteSlot: true },
    { visualIndex: 1, viewingCompleteSlot: false },
  ])('preserves the explicit viewport independently of currentIndex: $viewingCompleteSlot', (viewport) => {
    const view = decodeFreestyleLiveView({
      palaceId: 7,
      currentCardId: 'card-2',
      currentIndex: 0,
      queueCardIds: ['card-1', 'card-2'],
      ...viewport,
      roundId: 'round-9',
      planVersion: 12,
    })
    expect(view).toMatchObject({
      currentCardId: 'card-2',
      currentIndex: 0,
      ...viewport,
      roundId: 'round-9',
      planVersion: 12,
    })
    expect(decodeFreestyleLiveView(JSON.parse(serializeFreestyleLiveView(view!)))).toEqual(view)
  })

  it('falls back safely when viewport fields have invalid types or non-finite numbers', () => {
    expect(decodeFreestyleLiveView({
      currentIndex: 3,
      visualIndex: Number.NaN,
      viewingCompleteSlot: 'true',
      roundId: 9,
      planVersion: Number.POSITIVE_INFINITY,
    })).toMatchObject({
      currentIndex: 3,
      visualIndex: 3,
      viewingCompleteSlot: false,
      roundId: '',
      planVersion: 0,
    })
    expect(decodeFreestyleLiveView({})).toMatchObject({
      currentIndex: 0,
      visualIndex: 0,
      viewingCompleteSlot: false,
      roundId: '',
      planVersion: 0,
    })
  })

  it('reads the mirrored freestyle surface fields', () => {
    const view = decodeFreestyleLiveView({
      palaceId: 7,
      currentCardId: 'card-1',
      currentIndex: 2,
      queueCardIds: ['card-1', 'card-2'],
      questionState: { questionId: 9, state: { selectedOptionId: 'b', resolved: true } },
      revealMap: { 'node-a': 'revealed' },
      roundComplete: false,
      rating: {
        planVersion: 4,
        currentCardId: 'card-1',
        selectedRating: 3,
        passed: true,
        settled: [{ cardId: 'card-1', rating: 3, passed: true, restudy: false, retryAfterCards: 0 }],
      },
    })
    expect(view).toMatchObject({
      palaceId: 7,
      currentCardId: 'card-1',
      currentIndex: 2,
      questionState: { questionId: 9, state: { selectedOptionId: 'b' } },
      revealMap: { 'node-a': 'revealed' },
      rating: { selectedRating: 3, settled: [{ cardId: 'card-1', rating: 3 }] },
    })
  })

  it('treats an empty local rating as weaker than a remote score', () => {
    const remote = {
      planVersion: 2,
      currentCardId: 'card-1',
      selectedRating: 2,
      passed: false,
      settled: [{ cardId: 'card-1', rating: 2, passed: false, restudy: true, retryAfterCards: 3 }],
    }
    expect(isWeakerLiveRating(null, remote)).toBe(true)
    expect(isWeakerLiveRating(remote, remote)).toBe(false)
    expect(isWeakerLiveRating(remote, null)).toBe(false)
  })

  it('returns null for non-objects', () => {
    expect(decodeFreestyleLiveView(null)).toBeNull()
    expect(decodeFreestyleLiveView('freestyle')).toBeNull()
  })
})
