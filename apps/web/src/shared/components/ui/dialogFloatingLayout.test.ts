import { afterEach, describe, expect, it } from 'vitest'
import {
  createCenteredFloatingLayout,
  inferWidthFromClassName,
} from './dialogFloatingLayout'

describe('dialogFloatingLayout', () => {
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 768 })
  })

  it('reads compact width from max-w-* class names', () => {
    expect(inferWidthFromClassName('max-w-md')).toBe(448)
    expect(inferWidthFromClassName('foo max-w-lg bar')).toBe(512)
    expect(inferWidthFromClassName('no-max')).toBeNull()
  })

  it('centers a compact dialog using its inferred width, not the 820 default', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 })
    const layout = createCenteredFloatingLayout({ width: 448 })
    expect(layout.width).toBe(448)
    expect(layout.x).toBe(476)
    expect(layout.y).toBeGreaterThan(200)
  })
})
