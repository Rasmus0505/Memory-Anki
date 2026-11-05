import { describe, expect, it } from 'vitest'
import { themeColorFor, themeMotion } from './themePacks'

describe('study theme', () => {
  it('keeps the page-turn and flip rhythm the freestyle feed and mind map depend on', () => {
    expect(themeMotion()).toEqual({ pageTurnMs: 380, flipMs: 560, flipOvershootDeg: 13 })
  })

  it('answers the slate theme color for each scheme', () => {
    expect(themeColorFor('light')).toBe('#f8f9fb')
    expect(themeColorFor('dark')).toBe('#101114')
  })
})
