import { describe, expect, it } from 'vitest'
import { INITIAL_RARITY, RARE_BASE_CHANCE, RARE_PITY, pickRareShow, rareChance, rollRare } from './rarity'

describe('rare show pacing', () => {
  it('uses the base chance early and guarantees a show at pity', () => {
    expect(rareChance(0)).toBe(RARE_BASE_CHANCE)
    expect(rareChance(RARE_PITY - 1)).toBe(1)
    expect(rareChance(70)).toBeGreaterThan(RARE_BASE_CHANCE)
  })

  it('never shows on 忘记, but still advances the counter', () => {
    const { show, next } = rollRare({ sinceLast: RARE_PITY - 1, last: null }, false, () => 0)
    expect(show).toBeNull()
    expect(next.sinceLast).toBe(RARE_PITY)
  })

  it('resets the counter and remembers the show on a hit', () => {
    const { show, next } = rollRare(INITIAL_RARITY, true, () => 0)
    expect(show).not.toBeNull()
    expect(next).toEqual({ sinceLast: 0, last: show })
  })

  it('never repeats the previous show back to back', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(pickRareShow('koi', () => i / 20)).not.toBe('koi')
    }
  })

  it('averages roughly one show per 2–3 rounds of ~20 ratings', () => {
    let state = INITIAL_RARITY
    let shows = 0
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const ratings = 20_000
    for (let i = 0; i < ratings; i += 1) {
      const result = rollRare(state, true, random)
      state = result.next
      if (result.show) shows += 1
    }
    const perRound = shows / (ratings / 20)
    expect(perRound).toBeGreaterThan(1 / 3.2)
    expect(perRound).toBeLessThan(1 / 1.6)
  })
})
