import { describe, expect, it } from 'vitest'
import { deviceLocalCursor } from './deviceLocalCursor'

describe('device-local cursor after progress refresh', () => {
  it('keeps the local card even if the shared round points elsewhere', () => {
    expect(deviceLocalCursor(['a', 'b'], 'a', 'b')).toBe('a')
  })
  it('uses a valid saved card only when the local card is unavailable', () => {
    expect(deviceLocalCursor(['a', 'b'], 'removed', 'b')).toBe('b')
  })
  it('never returns a card removed from the refreshed queue', () => {
    expect(deviceLocalCursor(['a'], 'removed', 'removed')).toBe('a')
    expect(deviceLocalCursor([], 'a', 'b')).toBeNull()
  })
})
