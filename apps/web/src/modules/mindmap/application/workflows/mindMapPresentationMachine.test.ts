import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { mindMapPresentationMachine } from './mindMapPresentationMachine'

describe('mindMapPresentationMachine', () => {
  it('owns enter and exit without navigation or overlay events', () => {
    const actor = createActor(mindMapPresentationMachine).start()
    actor.send({ type: 'ENTER_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('enteringFullscreen')
    actor.send({ type: 'PRESENTATION_ENTERED' })
    expect(actor.getSnapshot().value).toBe('fullscreen')
    actor.send({ type: 'EXIT_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('exitingFullscreen')
    actor.send({ type: 'PRESENTATION_EXITED' })
    expect(actor.getSnapshot().value).toBe('embedded')
  })

  it('uses CSS fullscreen when the native API is unavailable', () => {
    const actor = createActor(mindMapPresentationMachine).start()
    actor.send({ type: 'ENTER_REQUESTED' })
    actor.send({ type: 'PRESENTATION_FAILED' })
    expect(actor.getSnapshot().value).toBe('fullscreen')
  })
})
