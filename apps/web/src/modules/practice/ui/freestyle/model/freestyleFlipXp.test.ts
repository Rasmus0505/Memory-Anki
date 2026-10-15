import { describe, expect, it } from 'vitest'
import { INITIAL_FLIP_XP, applyFlipXp, flipOrbCount, flipXpForChain, flipXpNeeded, flipXpTotal, ratingOrbCount } from './freestyleFlipXp'

describe('flip XP', () => {
  it('pays base XP for a lone flip and steps up inside a chain', () => {
    expect(flipXpForChain(1)).toBe(10)
    expect(flipXpForChain(2)).toBe(15)
    expect(flipXpForChain(5)).toBe(30)
    expect(flipXpForChain(9)).toBe(30)
  })

  it('chains only while flips land inside the window', () => {
    const first = applyFlipXp(INITIAL_FLIP_XP, 10_000)
    expect(first.chain).toBe(1)
    const second = applyFlipXp(first.state, 12_000)
    expect(second.chain).toBe(2)
    expect(second.gained).toBe(15)
    const late = applyFlipXp(second.state, 30_000)
    expect(late.chain).toBe(1)
    expect(late.gained).toBe(10)
  })

  it('levels up when the bar overflows and carries the remainder', () => {
    expect(flipXpNeeded(1)).toBe(40)
    // 35 + a lone flip (10) = 45: clears level 1 with 5 carried over.
    const gain = applyFlipXp({ xp: 35, level: 1, chain: 0, lastFlipAt: 0 }, 1_000)
    expect(gain.leveledUp).toBe(true)
    expect(gain.state.level).toBe(2)
    expect(gain.state.xp).toBe(5)
    // 20 + 10 = 30 stays below 40: no level change.
    const steady = applyFlipXp({ xp: 20, level: 1, chain: 0, lastFlipAt: 0 }, 1_000)
    expect(steady.leveledUp).toBe(false)
    expect(steady.state.level).toBe(1)
    expect(steady.state.xp).toBe(30)
  })

  it('never reads learning progress: the gain depends only on time and chain', () => {
    const state = { xp: 0, level: 1, chain: 0, lastFlipAt: 0 }
    expect(applyFlipXp(state, 500).gained).toBe(applyFlipXp(state, 9_999).gained)
  })
})

describe('orb counts', () => {
  it('scales flip orbs with the card label length, clamped to 1–12', () => {
    expect(flipOrbCount('')).toBe(1)
    expect(flipOrbCount('安全库存')).toBe(2)
    expect(flipOrbCount('经济订货量')).toBe(3)
    expect(flipOrbCount('一二三四五六七八九十一二三四五六七八九十')).toBe(10)
    expect(flipOrbCount('一'.repeat(60))).toBe(12)
  })

  it('gives rating orbs by grade, independent of the flip XP', () => {
    expect([1, 2, 3, 4].map((r) => ratingOrbCount(r as 1 | 2 | 3 | 4))).toEqual([1, 2, 3, 5])
  })
})

describe('flip XP session', () => {
  it('totals XP across cleared levels, not only the current bar', () => {
    expect(flipXpTotal({ xp: 0, level: 1 })).toBe(0)
    expect(flipXpTotal({ xp: 5, level: 2 })).toBe(45)
    expect(flipXpTotal({ xp: 0, level: 3 })).toBe(40 + 80)
  })
})
