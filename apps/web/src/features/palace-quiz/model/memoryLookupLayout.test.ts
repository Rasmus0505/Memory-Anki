import { describe, expect, it } from 'vitest'
import {
  calculateResizedMemoryLookupLayout,
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

  it('clamps oversized offscreen layout into the viewport', () => {
    expect(
      resolveMemoryLookupLayout(
        { x: 9999, y: -200, width: 9999, height: 9999, collapsed: true },
        800,
        600,
      ),
    ).toEqual({
      x: 12,
      y: 12,
      width: 776,
      height: 576,
      collapsed: true,
    })
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
