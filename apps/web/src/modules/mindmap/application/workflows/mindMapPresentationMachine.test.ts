import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { mindMapPresentationMachine } from './mindMapPresentationMachine'

describe('mindMapPresentationMachine', () => {
  it('owns enter and exit without navigation or overlay events', () => {
    const actor = createActor(mindMapPresentationMachine).start()
    actor.send({ type: 'ENTER_NATIVE_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('requestingNativeFullscreen')
    actor.send({ type: 'NATIVE_PRESENTATION_ENTERED' })
    expect(actor.getSnapshot().value).toBe('nativeFullscreen')
    actor.send({ type: 'EXIT_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('exitingFullscreen')
    actor.send({ type: 'PRESENTATION_EXITED' })
    expect(actor.getSnapshot().value).toBe('embedded')
  })

  it('records viewport fullscreen separately when the native API is unavailable', () => {
    const actor = createActor(mindMapPresentationMachine).start()
    actor.send({ type: 'ENTER_NATIVE_REQUESTED' })
    actor.send({ type: 'NATIVE_PRESENTATION_FAILED' })
    expect(actor.getSnapshot().value).toBe('viewportFullscreen')
  })

  it('enters viewport fullscreen without requesting native presentation', () => {
    const actor = createActor(mindMapPresentationMachine).start()
    actor.send({ type: 'ENTER_VIEWPORT_REQUESTED' })
    expect(actor.getSnapshot().value).toBe('viewportFullscreen')
  })
})
