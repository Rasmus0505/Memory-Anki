import { describe, expect, it, vi } from 'vitest'
import { buildGlassBell, buildLayeredPops } from './layeredPops'
import { sequencePeaks } from './voiceSynth'

const fundamental = (tones: ReturnType<typeof buildLayeredPops>) =>
  tones.filter((_, index) => index % 2 === 0)

describe('buildGlassBell', () => {
  it('matches the selected audition with double the peak loudness', () => {
    const [main, partial] = buildGlassBell()
    expect(main).toMatchObject({
      frequency: 1318.5, durationMs: 380, gain: 0.076, type: 'sine',
      offsetMs: 0, pan: 0, attackMs: 4, envelope: 'glass',
    })
    expect(partial!.frequency).toBeCloseTo(1318.5 * 2.4)
    expect(partial!.gain).toBeCloseTo(0.076 * 0.15)
    expect(partial!.durationMs).toBeCloseTo(380 * 0.52)
    expect(partial).toMatchObject({ type: 'sine', offsetMs: 0, pan: 0, attackMs: 4, envelope: 'glass' })
  })

  it('shares pitch, gain, timing and decay controls with event profiles', () => {
    const tones = buildGlassBell(880, 0.5, 120, 0.65)
    expect(tones[0]).toMatchObject({ frequency: 880, gain: 0.038, offsetMs: 120 })
    expect(tones[0]!.durationMs).toBeCloseTo(380 * 0.65)
    expect(tones[1]!.durationMs).toBeCloseTo(380 * 0.52 * 0.65)
  })
})

describe('buildLayeredPops', () => {
  it('sounds exactly one bell per object with no single-object pickup', () => {
    for (const role of ['reveal', 'deal', 'fold', 'remove', 'lift', 'select', 'unlink', 'land'] as const) {
      for (const count of [1, 2, 4, 12]) {
        const tones = buildLayeredPops({ role, count })
        expect(tones).toHaveLength(count * 2)
        expect(fundamental(tones)).toHaveLength(count)
        expect(tones[0]!.offsetMs).toBe(0)
      }
    }
  })

  it('spaces the first five bells by 82ms and the light tail by 38ms', () => {
    const offsets = fundamental(buildLayeredPops({ role: 'reveal', count: 8 })).map((tone) => tone.offsetMs)
    expect(offsets).toEqual([0, 82, 164, 246, 328, 366, 404, 442])
  })

  it('uses the audition pitch pattern rather than a continuous slide', () => {
    const tones = fundamental(buildLayeredPops({ role: 'reveal', count: 6 }))
    for (let index = 0; index < tones.length; index += 1) {
      expect(tones[index]!.frequency).toBeCloseTo(1318.5 * 2 ** ([0, 0, 2, 0, 4, 0][index]! / 12))
      expect(tones[index]!.endFrequency).toBeUndefined()
      expect(tones[index]!.pan).toBe(0)
    }
  })

  it('preserves clear opening gains and shortens the quieter tail', () => {
    const tones = fundamental(buildLayeredPops({ role: 'reveal', count: 20 }))
    for (let index = 0; index < tones.length; index += 1) {
      const scale = index < 5 ? 1 - index * 0.08 : Math.max(0.18, 0.57 - (index - 5) * 0.055)
      expect(tones[index]!.gain).toBeCloseTo(0.076 * scale)
      expect(tones[index]!.durationMs).toBeCloseTo(380 * (index < 5 ? 1 : 0.65))
    }
  })

  it('caps huge counts and safely handles invalid counts', () => {
    expect(buildLayeredPops({ role: 'remove', count: 500 })).toHaveLength(80)
    for (const count of [0, -1, NaN, Infinity, -Infinity]) {
      expect(buildLayeredPops({ role: 'reveal', count })).toEqual([])
    }
    expect(buildLayeredPops({ role: 'reveal', count: 1.6 })).toHaveLength(4)
    expect(buildLayeredPops({ role: 'reveal' })).toHaveLength(2)
  })

  it('gives grades the audition ratios and a fixed single bell', () => {
    for (const grade of [1, 2, 3, 4] as const) {
      const tones = buildLayeredPops({ role: 'grade', grade, count: 10 })
      expect(tones).toHaveLength(2)
      expect(tones[0]!.frequency).toBeCloseTo(1318.5 * [1, 9 / 8, 5 / 4, 4 / 3][grade - 1]!)
      expect(tones[0]!.gain).toBeCloseTo(0.076 * 0.82)
      expect(tones[0]!.durationMs).toBeCloseTo(380 * 1.1)
    }
  })

  it('tunes fold, remove and unlink down by .9 and reverses their pattern', () => {
    for (const role of ['fold', 'remove', 'unlink'] as const) {
      const tones = fundamental(buildLayeredPops({ role, count: 3 }))
      expect(tones[0]!.frequency).toBeCloseTo(1318.5 * 0.9)
      expect(tones[2]!.frequency).toBeCloseTo(1318.5 * 0.9 * 2 ** (-2 / 12))
    }
  })

  it('uses a gentle half-pitch denial without a punitive slide', () => {
    const tones = buildLayeredPops({ role: 'deny' })
    expect(tones).toHaveLength(2)
    expect(tones[0]!.frequency).toBe(1318.5 * 0.5)
    expect(tones[0]!.gain).toBeCloseTo(0.076 * 0.52)
    expect(tones[0]!.durationMs).toBeCloseTo(380 * 0.7)
    expect(tones.every((tone) => tone.endFrequency === undefined)).toBe(true)
  })

  it('rings completion as one higher bell and preserves progress transposition', () => {
    expect(buildLayeredPops({ role: 'close', count: 5 })).toHaveLength(2)
    expect(buildLayeredPops({ role: 'close' })[0]!.frequency).toBe(1318.5 * 4 / 3)
    for (const step of [1, 2, 3]) {
      expect(buildLayeredPops({ role: 'land', step })[0]!.frequency)
        .toBeCloseTo(1318.5 * 2 ** ((step - 1) * 2 / 12))
    }
    expect(buildLayeredPops({ role: 'land', step: NaN })[0]!.frequency).toBe(1318.5)
  })
})

describe('glass playback', () => {
  it('keeps its audition parameters through origin tuning', async () => {
    const { tuneToneSpec } = await import('./webAudioFeedback')
    const tone = buildGlassBell()[0]!
    expect(tuneToneSpec('pointer_click', tone, 'review', 'local')).toBe(tone)
    expect(tuneToneSpec('node_create', tone, 'system', 'global')).toBe(tone)
  })

  it('schedules only attack and exponential decay, with no sustained body', async () => {
    const { __resetWebAudioContextForTests, playWebAudioLayeredPops } = await import('./webAudioFeedback')
    const gains: Array<{ setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }> = []
    class GlassAudioContext {
      state = 'running'
      currentTime = 1
      destination = {}
      createOscillator() {
        return { type: 'sine', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      }
      createGain() {
        const gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
        gains.push(gain)
        return { gain, connect: vi.fn() }
      }
    }
    vi.stubGlobal('AudioContext', GlassAudioContext)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    __resetWebAudioContextForTests()
    try {
      playWebAudioLayeredPops({ role: 'reveal', volume: 1 })
      expect(gains).toHaveLength(2)
      const envelope = gains[0]!
      const [fundamental] = sequencePeaks([0.076, 0.076 * 0.15], 1)
      expect(envelope.linearRampToValueAtTime).not.toHaveBeenCalled()
      expect(envelope.exponentialRampToValueAtTime).toHaveBeenCalledTimes(2)
      expect(envelope.exponentialRampToValueAtTime.mock.calls[0]![0]).toBeCloseTo(fundamental ?? 0)
      expect(fundamental ?? 0).toBeGreaterThan(0.3)
      expect(envelope.exponentialRampToValueAtTime.mock.calls[0]![1]).toBeCloseTo(1.034)
      expect(envelope.exponentialRampToValueAtTime.mock.calls[1]![0]).toBe(0.0001)
      expect(envelope.exponentialRampToValueAtTime.mock.calls[1]![1]).toBeCloseTo(1.414)
      expect(gains[1]!.exponentialRampToValueAtTime.mock.calls[1]![1]).toBeCloseTo(1.034 + 0.38 * 0.52)
    } finally {
      __resetWebAudioContextForTests()
      vi.unstubAllGlobals()
    }
  })
})
