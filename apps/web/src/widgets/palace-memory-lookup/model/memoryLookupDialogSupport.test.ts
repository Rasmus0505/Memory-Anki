import { describe, expect, it } from 'vitest'
import { shouldBlockMemoryLookupClose } from './memoryLookupDialogSupport'

describe('memory lookup dialog lifecycle', () => {
  it('blocks dialog close while the embedded mind map is fullscreen', () => {
    expect(shouldBlockMemoryLookupClose({
      nextOpen: false,
      pinned: false,
      mindMapFullscreenActive: true,
    })).toBe(true)
  })

  it('allows normal close after fullscreen exits', () => {
    expect(shouldBlockMemoryLookupClose({
      nextOpen: false,
      pinned: false,
      mindMapFullscreenActive: false,
    })).toBe(false)
  })

  it('never blocks an open request', () => {
    expect(shouldBlockMemoryLookupClose({
      nextOpen: true,
      pinned: true,
      mindMapFullscreenActive: true,
    })).toBe(false)
  })
})
