import { describe, expect, it, vi } from 'vitest'
import { pickConcreteVoice, sanitizeSoundVoice } from './soundVoices'
import { sequencePeaks } from './voiceSynth'

describe('sound voices', () => {
  it('keeps a chosen set and falls back to mixed', () => {
    expect(sanitizeSoundVoice('crystal')).toBe('crystal')
    expect(sanitizeSoundVoice('wood')).toBe('wood')
    expect(sanitizeSoundVoice('celesta')).toBe('celesta')
    expect(sanitizeSoundVoice('mixed')).toBe('mixed')
    expect(sanitizeSoundVoice('classic')).toBe('mixed')
  })

  it('draws mixed once and does not re-roll inside the caller', () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.99)
    expect(pickConcreteVoice('mixed', random)).toBe('crystal')
    expect(pickConcreteVoice('mixed', random)).toBe('wood')
    expect(pickConcreteVoice('mixed', random)).toBe('celesta')
    expect(pickConcreteVoice('wood', random)).toBe('wood')
    expect(random).toHaveBeenCalledTimes(3)
  })

  it('lifts a quiet phrase without letting the volume slider stop mattering', () => {
    const [loud] = sequencePeaks([0.076], 1)
    const [quiet] = sequencePeaks([0.01], 1)
    const [softer] = sequencePeaks([0.01], 0.4)
    expect(loud ?? 0).toBeGreaterThan(0.3)
    expect(quiet ?? 0).toBeGreaterThan(0.3)
    expect(softer ?? 0).toBeLessThan(quiet ?? 0)
    expect(sequencePeaks([0.076], 0)).toEqual([0])
  })
})