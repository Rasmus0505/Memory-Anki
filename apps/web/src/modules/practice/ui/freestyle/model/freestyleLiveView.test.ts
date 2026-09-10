import { describe, expect, it } from 'vitest'
import { decodeFreestyleLiveView, isWeakerLiveRating } from './freestyleLiveView'

describe('decodeFreestyleLiveView', () => {
  it('reads the mirrored freestyle surface fields', () => {
    const view = decodeFreestyleLiveView({
      palaceId: 7,
      currentCardId: 'card-1',
      currentIndex: 2,
      queueCardIds: ['card-1', 'card-2'],
      flip: { cardId: 'card-1', flipped: true, revealedBacks: ['back-1'], focusUid: 'back-1' },
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
      flip: { flipped: true, revealedBacks: ['back-1'] },
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
