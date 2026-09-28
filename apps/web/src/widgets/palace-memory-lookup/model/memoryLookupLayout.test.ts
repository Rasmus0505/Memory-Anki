import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPalaceLookupMemory, resetWindowLayoutMemoryForTest } from '@/shared/preferences/windowLayoutMemory'
import {
  calculateResizedMemoryLookupLayout,
  MEMORY_LOOKUP_CAPSULE_HEIGHT,
  MEMORY_LOOKUP_CAPSULE_WIDTH,
  MEMORY_LOOKUP_VISIBLE_EDGE,
  MEMORY_LOOKUP_MIN_HEIGHT,
  MEMORY_LOOKUP_MIN_WIDTH,
  readMemoryLookupChrome,
  readMemoryLookupLayout,
  resolveMemoryLookupLayout,
  sanitizeMemoryLookupLayout,
  saveMemoryLookupLayout,
} from './memoryLookupLayout'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
}

describe('memoryLookupLayout', () => {
  it('sanitizes invalid stored layout with fallback dimensions', () => {
    expect(
      sanitizeMemoryLookupLayout(
        { x: 'bad', y: Number.NaN, width: 10, height: 20, collapsed: 1 },
        { x: 24, y: 80, width: 720, height: 520, collapsed: false },
      ),
    ).toEqual({
      x: 24,
      y: 80,
      width: MEMORY_LOOKUP_MIN_WIDTH,
      height: MEMORY_LOOKUP_MIN_HEIGHT,
      collapsed: true,
    })
  })

  it('keeps restored oversized layouts reachable while preserving a visible edge', () => {
    const layout = resolveMemoryLookupLayout(
      { x: 9999, y: -200, width: 9999, height: 9999, collapsed: true },
      800,
      600,
    )

    expect(layout).toEqual({
      x: 800 - MEMORY_LOOKUP_VISIBLE_EDGE,
      y: 0,
      width: 776,
      height: 576,
      collapsed: true,
    })
    expect(layout.y).toBeGreaterThanOrEqual(MEMORY_LOOKUP_VISIBLE_EDGE - MEMORY_LOOKUP_CAPSULE_HEIGHT)
    expect(layout.y).toBeLessThanOrEqual(600 - MEMORY_LOOKUP_VISIBLE_EDGE)
  })

  it('uses capsule dimensions for collapsed layout reachability instead of the expanded window size', () => {
    const layout = resolveMemoryLookupLayout(
      { x: 620, y: 520, width: 760, height: 520, collapsed: true },
      800,
      600,
    )

    expect(layout.x).toBeLessThanOrEqual(800 - MEMORY_LOOKUP_VISIBLE_EDGE)
    expect(layout.x).toBeGreaterThanOrEqual(MEMORY_LOOKUP_VISIBLE_EDGE - MEMORY_LOOKUP_CAPSULE_WIDTH)
    expect(layout.y).toBeLessThanOrEqual(600 - MEMORY_LOOKUP_VISIBLE_EDGE)
    expect(layout.y).toBeGreaterThanOrEqual(MEMORY_LOOKUP_VISIBLE_EDGE - MEMORY_LOOKUP_CAPSULE_HEIGHT)
    expect(layout.x).toBe(620)
    expect(layout.y).toBe(12)
  })

  it('allows a floating window to sit partly outside every viewport edge', () => {
    const left = resolveMemoryLookupLayout(
      { x: -420, y: 80, width: 500, height: 320, collapsed: false },
      800,
      600,
    )
    expect(left.x).toBeGreaterThanOrEqual(MEMORY_LOOKUP_VISIBLE_EDGE - left.width)
    expect(left.x).toBeLessThan(0)

    const right = resolveMemoryLookupLayout(
      { x: 790, y: 80, width: 500, height: 320, collapsed: false },
      800,
      600,
    )
    expect(right.x).toBe(800 - MEMORY_LOOKUP_VISIBLE_EDGE)

    const top = resolveMemoryLookupLayout(
      { x: 80, y: -300, width: 500, height: 320, collapsed: false },
      800,
      600,
    )
    expect(top.y).toBe(MEMORY_LOOKUP_VISIBLE_EDGE - top.height)

    const bottom = resolveMemoryLookupLayout(
      { x: 80, y: 590, width: 500, height: 320, collapsed: false },
      800,
      600,
    )
    expect(bottom.y).toBe(600 - MEMORY_LOOKUP_VISIBLE_EDGE)
  })

  it('resizes larger from the south-east corner', () => {
    expect(
      calculateResizedMemoryLookupLayout(
        {
          direction: 'se',
          startX: 0,
          startY: 0,
          x: 100,
          y: 80,
          width: 500,
          height: 300,
        },
        40,
        32,
        1000,
        700,
      ),
    ).toEqual({
      x: 100,
      y: 80,
      width: 540,
      height: 332,
    })
  })

  it('resizes from the north-west corner while clamping to viewport', () => {
    expect(
      calculateResizedMemoryLookupLayout(
        {
          direction: 'nw',
          startX: 0,
          startY: 0,
          x: 100,
          y: 80,
          width: 500,
          height: 300,
        },
        -60,
        -90,
        1000,
        700,
      ),
    ).toEqual({
      x: 40,
      y: 12,
      width: 560,
      height: 368,
    })
  })
})

describe('memory lookup window ratio memory', () => {
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

  it('restores a manual size after the viewport shrinks and grows again', () => {
    saveMemoryLookupLayout(
      { x: 48, y: 36, width: 900, height: 600, collapsed: false },
      { rememberPosition: true, rememberSize: true },
    )

    expect(readPalaceLookupMemory()).toMatchObject({ widthRatio: 0.75, heightRatio: 0.75 })

    setViewport(420, 320)
    const shrunk = readMemoryLookupLayout()
    expect(shrunk.width).toBeLessThan(900)
    expect(shrunk.height).toBeLessThan(600)
    expect(readPalaceLookupMemory()).toMatchObject({ widthRatio: 0.75, heightRatio: 0.75 })

    setViewport(1200, 800)
    expect(readMemoryLookupLayout()).toMatchObject({ width: 900, height: 600, x: 48, y: 36 })
  })

  it('keeps the size ratio when a clamped layout is saved for position only', () => {
    saveMemoryLookupLayout(
      { x: 48, y: 36, width: 900, height: 600, collapsed: false },
      { rememberPosition: true, rememberSize: true },
    )
    setViewport(420, 320)
    saveMemoryLookupLayout(readMemoryLookupLayout(), { rememberPosition: true, rememberSize: false })

    expect(readPalaceLookupMemory()).toMatchObject({ widthRatio: 0.75, heightRatio: 0.75 })
    setViewport(1200, 800)
    expect(readMemoryLookupLayout()).toMatchObject({ width: 900, height: 600 })
  })

  it('remembers pin and list collapse without replacing the size ratio', () => {
    saveMemoryLookupLayout(
      { x: 48, y: 36, width: 900, height: 600, collapsed: false },
      { rememberPosition: true, rememberSize: true },
    )
    saveMemoryLookupLayout(
      { x: 12, y: 12, width: 400, height: 300, collapsed: true },
      { rememberPosition: false, rememberSize: false, pinned: true, listCollapsed: true },
    )

    expect(readPalaceLookupMemory()).toMatchObject({
      widthRatio: 0.75,
      heightRatio: 0.75,
      collapsed: true,
      pinned: true,
      listCollapsed: true,
    })
    expect(readMemoryLookupChrome()).toEqual({ pinned: true, listCollapsed: true })
  })
})
