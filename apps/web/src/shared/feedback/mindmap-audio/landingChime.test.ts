import { describe, expect, it } from 'vitest'
import { getLandingChimeTone } from './toneProfiles'

describe('getLandingChimeTone', () => {
  it('rises a semitone per combo step and caps after an octave', () => {
    const base = getLandingChimeTone(0)[0].frequency
    expect(getLandingChimeTone(1)[0].frequency).toBeCloseTo(base * 2 ** (1 / 12))
    expect(getLandingChimeTone(12)[0].frequency).toBeCloseTo(base * 2)
    expect(getLandingChimeTone(40)[0].frequency).toBeCloseTo(base * 2)
  })

  it('stays quieter than the combo milestone tone', () => {
    for (const tone of getLandingChimeTone(5)) expect(tone.gain).toBeLessThan(0.03)
  })
})
