import { describe, expect, it } from 'vitest'
import {
  acceptRating,
  emptyMailbox,
  isCurrentIntent,
  noteInflightDone,
  ratingPassed,
  requestUndo,
  type RateTicket,
} from './ratingOutbox'

function ticket(rating: RateTicket['rating'], operationId: string): Omit<RateTicket, 'generation'> {
  return {
    rating,
    operationId,
    cardId: 'card-1',
    occurrenceId: '',
    encounterId: 'encounter-1',
    unitId: 'unit-1',
    sessionId: 'session-1',
    unitRevision: 3,
  }
}

describe('ratingOutbox', () => {
  it('treats 记得 and 轻松 as a local pass', () => {
    expect(ratingPassed(1)).toBe(false)
    expect(ratingPassed(2)).toBe(false)
    expect(ratingPassed(3)).toBe(true)
    expect(ratingPassed(4)).toBe(true)
  })

  it('sends the first grade immediately and queues a newer one behind it', () => {
    const first = acceptRating(emptyMailbox(), ticket(3, 'op-1'))
    expect(first.sendNow).toBe(true)
    expect(first.box.inflight?.rating).toBe(3)

    const second = acceptRating(first.box, ticket(4, 'op-2'))
    expect(second.sendNow).toBe(false)
    expect(second.box.queued?.rating).toBe(4)
    expect(isCurrentIntent(second.box, first.ticket.generation)).toBe(false)
    expect(isCurrentIntent(second.box, second.ticket.generation)).toBe(true)

    const follow = noteInflightDone(second.box, first.ticket.generation)
    expect(follow.undo).toBe(false)
    expect(follow.send?.operationId).toBe('op-2')
    expect(follow.box.inflight?.rating).toBe(4)
  })

  it('undoes the grade on the wire instead of sending a queued amend', () => {
    const first = acceptRating(emptyMailbox(), ticket(3, 'op-1'))
    const undone = requestUndo(first.box)
    expect(isCurrentIntent(undone, first.ticket.generation)).toBe(false)
    const follow = noteInflightDone(undone, first.ticket.generation)
    expect(follow.undo).toBe(true)
    expect(follow.send).toBeNull()
    expect(follow.box.inflight).toBeNull()
  })
})
