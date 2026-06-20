import { describe, expect, it, vi } from 'vitest'
import { emitReviewConfetti } from '@/shared/components/celebration/reviewConfetti'

const notifyFeedback = vi.fn()

vi.mock('@/shared/feedback/feedbackCenter', () => ({
  notifyFeedback: (...args: unknown[]) => notifyFeedback(...args),
}))

describe('review confetti bridge', () => {
  it('maps session completion to the strongest global preset by default', () => {
    emitReviewConfetti({
      kind: 'session_complete',
      reducedMotion: false,
      soundEnabled: true,
      volume: 1,
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

  it('uses the explicitly passed confettiPreset instead of the kind default', () => {
    emitReviewConfetti({
      kind: 'milestone',
      reducedMotion: false,
      soundEnabled: true,
      volume: 1,
      confettiPreset: 'stars',
    })

    expect(notifyFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: 'review_milestone',
        celebration: expect.objectContaining({
          preset: 'stars',
        }),
      }),
    )
  })
})
