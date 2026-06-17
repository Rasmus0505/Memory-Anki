import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCelebrationEngineForTests,
  getCelebrationSteps,
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

  it('keeps every burst anchored to viewport edges', () => {
    const bursts = getCelebrationSteps('school_pride').flatMap((step) => step.bursts)

    expect(
      bursts.every((burst) =>
        burst.origin.x <= 0.18 ||
        burst.origin.x >= 0.82 ||
        burst.origin.y <= 0.08 ||
        burst.origin.y >= 0.84,
      ),
    ).toBe(true)
  })
})
