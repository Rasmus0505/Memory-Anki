import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'

const notifyFeedback = vi.fn()

vi.mock('@/shared/feedback/feedbackCenter', () => ({
  notifyFeedback: (...args: unknown[]) => notifyFeedback(...args),
}))

describe('timer celebration', () => {
  beforeEach(() => {
    notifyFeedback.mockReset()
  })

  it('keeps visual feedback but suppresses sound in visual_only mode', () => {
    emitTimerCelebration({
      completionCount: 4,
      kind: 'secondary',
      reducedMotion: false,
      soundEnabled: true,
      volume: 1,
      feedbackIntensity: 'visual_only',
    })

    expect(notifyFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: 'timer_secondary_complete',
        celebration: expect.objectContaining({
          preset: 'random_direction',
          soundEnabled: false,
        }),
      }),
    )
  })
})
