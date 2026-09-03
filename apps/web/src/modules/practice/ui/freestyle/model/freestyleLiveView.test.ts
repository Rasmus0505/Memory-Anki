import { describe, expect, it } from 'vitest'
import { decodeFreestyleLiveView } from './freestyleLiveView'

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
    })
    expect(view).toMatchObject({
      palaceId: 7,
      currentCardId: 'card-1',
      currentIndex: 2,
      flip: { flipped: true, revealedBacks: ['back-1'] },
      questionState: { questionId: 9, state: { selectedOptionId: 'b' } },
      revealMap: { 'node-a': 'revealed' },
    })
  })

  it('returns null for non-objects', () => {
    expect(decodeFreestyleLiveView(null)).toBeNull()
    expect(decodeFreestyleLiveView('freestyle')).toBeNull()
  })
})
