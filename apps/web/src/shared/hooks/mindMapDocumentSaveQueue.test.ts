import { describe, expect, it } from 'vitest'
import { createSavePromiseTracker } from './mindMapDocumentSaveQueue'

describe('createSavePromiseTracker', () => {
  it('waits until the tracked save settles', async () => {
    const tracker = createSavePromiseTracker()
    let released = false
    let resolveSave!: () => void
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    void tracker.track(() => save)
    const waiter = tracker.wait().then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)
    resolveSave()
    await waiter
    expect(released).toBe(true)
  })
})
