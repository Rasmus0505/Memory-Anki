import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { freestyleTrainingMachine } from './freestyleTrainingMachine'

describe('freestyleTrainingMachine', () => {
  it('does not complete from scrolling or an invalid completion request', () => {
    const actor = createActor(freestyleTrainingMachine).start()
    actor.send({ type: 'ROUND_SYNCED', cards: [{ id: 'q1', quizQuestionId: 1 }, { id: 'q2', quizQuestionId: 2 }], currentIndex: 0, resolvedQuestionIds: [] })
    actor.send({ type: 'SCROLL_SETTLED', currentIndex: 99 })
    actor.send({ type: 'ROUND_COMPLETE_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('training')
    expect(actor.getSnapshot().context.currentIndex).toBe(1)
  })

  it('completes only after the domain guard accepts every answer', () => {
    const actor = createActor(freestyleTrainingMachine).start()
    actor.send({ type: 'ROUND_SYNCED', cards: [{ id: 'q1', quizQuestionId: 1 }, { id: 'q2', quizQuestionId: 2 }], currentIndex: 2, resolvedQuestionIds: [1, 2] })
    actor.send({ type: 'ROUND_COMPLETE_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('completed')
  })
})
