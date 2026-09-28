import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetWindowLayoutMemoryForTest, readFloatingDialogMemory } from '@/shared/preferences/windowLayoutMemory'
import { applyRememberedFloatingSize, writeStoredFloatingLayout } from './dialogFloatingLayout'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('dialog floating layout ratios', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    setViewport(1200, 800)
  })

  afterEach(() => {
    window.localStorage.clear()
    resetWindowLayoutMemoryForTest()
    setViewport(1024, 768)
  })

  it('keeps a manual width ratio when a smaller viewport is applied', () => {
    const storageKey = 'memory-anki-floating-dialog:ratio'
    writeStoredFloatingLayout(
      storageKey,
      { x: 80, y: 40, width: 900, height: 500, collapsed: false, pinned: false },
      { size: true, position: true },
    )

    setViewport(500, 400)
    const applied = applyRememberedFloatingSize(storageKey, {
      x: 40,
      y: 40,
      width: 200,
      height: 180,
      collapsed: false,
      pinned: true,
    })

    expect(applied.width).toBeLessThan(900)
    expect(applied.pinned).toBe(true)
    expect(readFloatingDialogMemory('ratio')?.widthRatio).toBe(0.75)
    setViewport(1200, 800)
    expect(applyRememberedFloatingSize(storageKey, applied).width).toBe(900)
  })
})
