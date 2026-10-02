import { describe, expect, it } from 'vitest'
import { crispMindMapViewport } from './mindMapViewportConfig'

describe('crispMindMapViewport', () => {
  it('snaps a zoom-1 camera onto whole pixels so glyphs are not resampled', () => {
    expect(crispMindMapViewport({ x: 4.4, y: 17.6, zoom: 1.00004 })).toEqual({
      x: 4,
      y: 18,
      zoom: 1,
    })
  })

  it('leaves an intentional non-1 zoom untouched', () => {
    const zoomed = { x: 3.2, y: 9.8, zoom: 0.86 }
    expect(crispMindMapViewport(zoomed)).toBe(zoomed)
  })

  it('returns the same object when zoom 1 is already on whole pixels', () => {
    const resting = { x: 4, y: 18, zoom: 1 }
    expect(crispMindMapViewport(resting)).toBe(resting)
  })
})
