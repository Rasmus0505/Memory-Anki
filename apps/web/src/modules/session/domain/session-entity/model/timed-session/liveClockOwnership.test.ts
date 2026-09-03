import { afterEach, describe, expect, it } from 'vitest'
import {
  isLiveForegroundClockSuppressed,
  resetLiveForegroundClockForTests,
  setLiveForegroundClockSuppressed,
  subscribeLiveForegroundClock,
} from './liveClockOwnership'

describe('liveClockOwnership', () => {
  afterEach(() => {
    resetLiveForegroundClockForTests()
  })

  it('notifies listeners when suppression changes', () => {
    const seen: boolean[] = []
    const stop = subscribeLiveForegroundClock(() => seen.push(isLiveForegroundClockSuppressed()))
    setLiveForegroundClockSuppressed(true)
    setLiveForegroundClockSuppressed(true)
    setLiveForegroundClockSuppressed(false)
    stop()
    expect(seen).toEqual([true, false])
  })
})
