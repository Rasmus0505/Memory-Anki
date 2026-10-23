import { describe, expect, it } from 'vitest'
import { applyMaskDrag, clampMaskRect, DEFAULT_MASK_RECT } from './dictationLayout'

describe('dictation mask geometry', () => {
  it('moves without changing the rectangle size and clamps to the frame', () => {
    const moved = applyMaskDrag({ x: 4, y: 62, w: 92, h: 30 }, 'move', 20, 10)
    expect(moved).toEqual({ x: 8, y: 70, w: 92, h: 30 })
    expect(applyMaskDrag({ x: 10, y: 10, w: 50, h: 30 }, 'move', -40, -40)).toEqual({
      x: 0,
      y: 0,
      w: 50,
      h: 30,
    })
  })

  it('resizes from each edge and honours the minimum size', () => {
    expect(applyMaskDrag({ x: 20, y: 20, w: 40, h: 30 }, 'w', -10, 0)).toEqual({
      x: 10,
      y: 20,
      w: 50,
      h: 30,
    })
    expect(applyMaskDrag({ x: 20, y: 20, w: 40, h: 30 }, 'e', -100, 0).w).toBe(8)
    expect(applyMaskDrag({ x: 20, y: 20, w: 40, h: 30 }, 'se', 10, 10)).toEqual({
      x: 20,
      y: 20,
      w: 50,
      h: 40,
    })
  })

  it('clamps stored rectangles and supplies safe defaults', () => {
    expect(clampMaskRect(null)).toEqual(DEFAULT_MASK_RECT)
    expect(clampMaskRect({ x: 90, y: 90, w: 50, h: 50 })).toEqual({ x: 50, y: 50, w: 50, h: 50 })
  })
})
