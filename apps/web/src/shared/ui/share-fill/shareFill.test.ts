import { describe, expect, it } from 'vitest'
import { NEUTRAL_SHARE_FILL, shareFillBackground, shareRatio } from './shareFill'

describe('shareRatio', () => {
  it('divides the part by the whole', () => {
    expect(shareRatio(3, 20)).toBeCloseTo(0.15)
  })

  it('reads an unknown or empty whole as zero', () => {
    expect(shareRatio(3, null)).toBe(0)
    expect(shareRatio(3, 0)).toBe(0)
    expect(shareRatio(null, 20)).toBe(0)
  })

  it('clamps a part larger than its whole', () => {
    expect(shareRatio(25, 20)).toBe(1)
  })
})

describe('shareFillBackground', () => {
  it('fills from the left edge up to the rounded percent', () => {
    const background = shareFillBackground(0.15, NEUTRAL_SHARE_FILL)
    expect(background).toContain('15%')
    expect(background).toContain(NEUTRAL_SHARE_FILL)
    expect(background?.startsWith('linear-gradient(to right,')).toBe(true)
  })

  it('returns null when there is nothing to fill', () => {
    expect(shareFillBackground(0, NEUTRAL_SHARE_FILL)).toBeNull()
  })
})
