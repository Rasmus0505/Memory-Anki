import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCelebrationEngineForTests,
  __setCelebrationBurstSinkForTests,
  getCelebrationPresetDebugConfig,
  launchCelebrationPreset,
  type CelebrationBurst,
} from '@/shared/feedback/celebrationEngine'

describe('celebrationEngine', () => {
  const bursts: CelebrationBurst[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    bursts.length = 0
    __resetCelebrationEngineForTests()
    __setCelebrationBurstSinkForTests((burst) => bursts.push(burst))
  })

  afterEach(() => {
    __setCelebrationBurstSinkForTests(null)
    vi.useRealTimers()
  })

  it('fires continuously instead of a single static burst', () => {
    launchCelebrationPreset({ preset: 'fireworks', reducedMotion: false, amount: 1.5, scenario: 'milestone' })
    expect(bursts).toHaveLength(2)
    vi.advanceTimersByTime(320)
    expect(bursts.length).toBeGreaterThan(2)
  })

  it('stays silent under reduced motion', () => {
    launchCelebrationPreset({ preset: 'stars', reducedMotion: true })
    vi.advanceTimersByTime(1000)
    expect(bursts).toHaveLength(0)
  })

  it('a new launch cancels the previous run', () => {
    launchCelebrationPreset({ preset: 'fireworks', reducedMotion: false, durationMs: 2000 })
    launchCelebrationPreset({ preset: 'random_direction', reducedMotion: false, durationMs: 200 })
    bursts.length = 0
    vi.advanceTimersByTime(2000)
    expect(bursts.every((burst) => burst.spread !== 360)).toBe(true)
  })

  it('scales stronger presets above lighter ones', () => {
    const total = () => bursts.reduce((sum, burst) => sum + burst.particleCount, 0)
    launchCelebrationPreset({ preset: 'random_direction', reducedMotion: false, amount: 0.55, durationMs: 600, scenario: 'review' })
    vi.advanceTimersByTime(600)
    const light = { calls: bursts.length, particles: total() }
    bursts.length = 0
    launchCelebrationPreset({ preset: 'school_pride', reducedMotion: false, amount: 2.2, durationMs: 1500, scenario: 'timer' })
    vi.advanceTimersByTime(1500)
    expect(bursts.length).toBeGreaterThan(light.calls)
    expect(total()).toBeGreaterThan(light.particles)
  })

  it('exposes preset debug config for assertions instead of burst snapshots', () => {
    const config = getCelebrationPresetDebugConfig('school_pride')
    expect(config.name).toBe('school_pride')
    expect(config.speed).toBeGreaterThan(getCelebrationPresetDebugConfig('random_direction').speed)
    expect(config.maxDurationMs).toBeGreaterThan(config.minDurationMs)
  })
})
