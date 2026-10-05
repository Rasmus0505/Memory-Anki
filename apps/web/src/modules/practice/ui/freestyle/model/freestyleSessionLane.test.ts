import { beforeEach, describe, expect, it } from 'vitest'
import {
  enqueueFreestyleSessionTask,
  resetFreestyleSessionLaneForTests,
  whenFreestyleSessionLaneIdle,
} from './freestyleSessionLane'

describe('freestyleSessionLane', () => {
  beforeEach(() => {
    resetFreestyleSessionLaneForTests()
  })

  it('runs session writes one at a time', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = enqueueFreestyleSessionTask(async () => {
      order.push('first')
      await gate
      order.push('first-done')
    })
    const second = enqueueFreestyleSessionTask(async () => {
      order.push('second')
    })
    await Promise.resolve()
    expect(order).toEqual(['first'])
    let idle = false
    void whenFreestyleSessionLaneIdle().then(() => {
      idle = true
    })
    await Promise.resolve()
    expect(idle).toBe(false)
    release()
    await first
    await second
    expect(order).toEqual(['first', 'first-done', 'second'])
    await whenFreestyleSessionLaneIdle()
    expect(idle).toBe(true)
  })

  it('drops a queued write after a test reset', async () => {
    let ran = false
    void enqueueFreestyleSessionTask(async () => {
      ran = true
    })
    resetFreestyleSessionLaneForTests()
    await Promise.resolve()
    expect(ran).toBe(false)
  })
})
