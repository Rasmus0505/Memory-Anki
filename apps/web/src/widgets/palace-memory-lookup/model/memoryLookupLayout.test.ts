import { describe, expect, it } from 'vitest'
import {
  calculateResizedMemoryLookupLayout,
  MEMORY_LOOKUP_CAPSULE_HEIGHT,
  MEMORY_LOOKUP_CAPSULE_WIDTH,
  MEMORY_LOOKUP_VISIBLE_EDGE,
  MEMORY_LOOKUP_MIN_HEIGHT,
  MEMORY_LOOKUP_MIN_WIDTH,
  resolveMemoryLookupLayout,
  sanitizeMemoryLookupLayout,
} from './memoryLookupLayout'

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
