import { describe, expect, it } from 'vitest'
import { colorTone, PACK_TIMBRE_VOICES } from './packTimbre'
import type { ToneSpec } from './toneProfiles'

const tone: ToneSpec = {
  frequency: 440,
  endFrequency: 880,
  durationMs: 100,
  gain: 0.02,
  type: 'sine',
  offsetMs: 0,
  attackMs: 4,
}

describe('packTimbre', () => {
  it('keeps the four pack voices distinct and finite', () => {
    const voices = Object.values(PACK_TIMBRE_VOICES)
    expect(voices).toHaveLength(4)
    for (const voice of voices) {
      expect(voice.pitch).toBeGreaterThan(0.5)
      expect(voice.pitch).toBeLessThan(2)
      expect(voice.duration).toBeGreaterThan(0)
    }
    expect(PACK_TIMBRE_VOICES['paper-wood'].type).toBe('triangle')
    expect(PACK_TIMBRE_VOICES['bell-lacquer'].type).toBe('sine')
    expect(PACK_TIMBRE_VOICES['celesta-chime'].pitch).toBeGreaterThan(PACK_TIMBRE_VOICES['bell-lacquer'].pitch)
    expect(PACK_TIMBRE_VOICES['marimba-water'].pitch).toBeLessThan(PACK_TIMBRE_VOICES['paper-wood'].pitch)
  })

  it('recolors a tone without inventing a new event', () => {
    const wood = colorTone(tone, 'paper-wood')
    const bell = colorTone(tone, 'bell-lacquer')
    expect(wood.type).toBe('triangle')
    expect(wood.frequency).toBeCloseTo(440 * 0.9)
    expect(bell.type).toBe('sine')
    expect(bell.frequency).toBeGreaterThan(wood.frequency)
    expect(bell.durationMs).toBeGreaterThan(wood.durationMs)
  })
})
