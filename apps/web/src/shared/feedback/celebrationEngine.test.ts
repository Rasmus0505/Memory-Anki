import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCelebrationEngineForTests,
  getCelebrationPresetDebugConfig,
  launchCelebrationPreset,
} from '@/shared/feedback/celebrationEngine'

const { create, fire } = vi.hoisted(() => {
  const fireMock = vi.fn()
  const createMock = vi.fn(() => fireMock)
  return {
    create: createMock,
    fire: fireMock,
  }
})

vi.mock('canvas-confetti', () => {
  const confetti = Object.assign(vi.fn(), { create })
  return {
    default: confetti,
  }
})

describe('celebrationEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fire.mockReset()
    create.mockReset()
    create.mockReturnValue(fire)
    __resetCelebrationEngineForTests()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mounts a single global canvas at the highest layer', () => {
    launchCelebrationPreset({
      preset: 'fireworks',
      reducedMotion: false,
    })

    const canvas = document.getElementById('memory-anki-global-confetti-canvas')
    expect(canvas).toBeTruthy()
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect((canvas as HTMLCanvasElement).style.position).toBe('fixed')
    expect((canvas as HTMLCanvasElement).style.pointerEvents).toBe('none')
    expect((canvas as HTMLCanvasElement).style.zIndex).toBe('2147483647')
    expect(create).toHaveBeenCalledTimes(1)

    launchCelebrationPreset({
      preset: 'stars',
      reducedMotion: false,
    })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('fires continuously instead of a single static burst', () => {
    launchCelebrationPreset({
      preset: 'fireworks',
      reducedMotion: false,
      amount: 1.5,
      scenario: 'milestone',
    })

    expect(fire).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(320)
    expect(fire.mock.calls.length).toBeGreaterThan(2)
  })

  it('scales stronger presets above lighter ones', () => {
    launchCelebrationPreset({
      preset: 'random_direction',
      reducedMotion: false,
      amount: 0.55,
      durationMs: 600,
      scenario: 'review',
    })
    vi.advanceTimersByTime(600)
    const lightCallCount = fire.mock.calls.length
    const lightParticleTotal = fire.mock.calls.reduce(
      (sum, [options]) => sum + Number((options as { particleCount?: number }).particleCount ?? 0),
      0,
    )

    fire.mockClear()

    launchCelebrationPreset({
      preset: 'school_pride',
      reducedMotion: false,
      amount: 2.2,
      durationMs: 1500,
      scenario: 'timer',
    })
    vi.advanceTimersByTime(1500)
    const strongCallCount = fire.mock.calls.length
    const strongParticleTotal = fire.mock.calls.reduce(
      (sum, [options]) => sum + Number((options as { particleCount?: number }).particleCount ?? 0),
      0,
    )

    expect(strongCallCount).toBeGreaterThan(lightCallCount)
    expect(strongParticleTotal).toBeGreaterThan(lightParticleTotal)
  })

  it('exposes preset debug config for assertions instead of burst snapshots', () => {
    const config = getCelebrationPresetDebugConfig('school_pride')

    expect(config.name).toBe('school_pride')
    expect(config.speed).toBeGreaterThan(getCelebrationPresetDebugConfig('random_direction').speed)
    expect(config.maxDurationMs).toBeGreaterThan(config.minDurationMs)
  })
})
