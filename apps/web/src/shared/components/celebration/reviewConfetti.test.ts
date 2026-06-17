import { describe, expect, it, vi } from 'vitest'
import { emitReviewConfetti } from '@/shared/components/celebration/reviewConfetti'

const notifyFeedback = vi.fn()

vi.mock('@/shared/feedback/feedbackCenter', () => ({
  notifyFeedback: (...args: unknown[]) => notifyFeedback(...args),
}))

describe('review confetti bridge', () => {
  it('maps session completion to the strongest global preset', () => {
    emitReviewConfetti({
      kind: 'session_complete',
      reducedMotion: false,
      criticalFxIntensity: 'cinematic',
      soundEnabled: true,
      volume: 1,
      confettiAmount: 2.5,
    })

    expect(notifyFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: 'review_complete',
        celebration: expect.objectContaining({
          preset: 'school_pride',
        }),
      }),
    )
  })
})
