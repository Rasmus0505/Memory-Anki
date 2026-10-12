import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitReviewCelebration } from '@/shared/components/celebration/reviewCelebration'

const mocks = vi.hoisted(() => ({
  cue: vi.fn(),
  triggerCelebration: vi.fn(),
}))

vi.mock('@/shared/fx', () => ({
  cue: (...args: unknown[]) => mocks.cue(...args),
}))

vi.mock('@/shared/feedback/feedbackCenter', () => ({
  triggerCelebration: (...args: unknown[]) => mocks.triggerCelebration(...args),
}))

describe('emitReviewCelebration', () => {
  beforeEach(() => {
    mocks.cue.mockReset()
    mocks.triggerCelebration.mockReset()
  })

  it.each(['all_clear_ready', 'session_complete'] as const)(
    'routes %s through the round.complete cue',
    (kind) => {
      emitReviewCelebration({ kind, reducedMotion: true, soundEnabled: true })

      expect(mocks.cue).toHaveBeenCalledWith('round.complete', { quiet: true })
      expect(mocks.triggerCelebration).not.toHaveBeenCalled()
    },
  )

  it('passes reduced motion as quiet on completion cues', () => {
    emitReviewCelebration({ kind: 'session_complete', reducedMotion: false })

    expect(mocks.cue).toHaveBeenCalledWith('round.complete', { quiet: false })
  })

  it('sends milestones to triggerCelebration with the milestone step', () => {
    emitReviewCelebration({
      kind: 'milestone',
      reducedMotion: false,
      milestoneStep: 8,
      soundEnabled: true,
      volume: 1.5,
    })

    expect(mocks.cue).not.toHaveBeenCalled()
    expect(mocks.triggerCelebration).toHaveBeenCalledWith({
      scenario: 'milestone',
      soundEnabled: true,
      volume: 1.5,
      audioCue: { kind: 'milestone', milestoneStep: 8 },
    })
  })

  it('maps branch clears to the review scenario', () => {
    emitReviewCelebration({ kind: 'branch_clear', reducedMotion: false, soundEnabled: true })

    expect(mocks.triggerCelebration).toHaveBeenCalledWith({
      scenario: 'review',
      soundEnabled: true,
      volume: 1,
      audioCue: { kind: 'branch_clear', milestoneStep: null },
    })
  })

  it('maps quiz_correct to the quiz scenario with a branch_clear audio cue', () => {
    emitReviewCelebration({ kind: 'quiz_correct', reducedMotion: false })

    expect(mocks.triggerCelebration).toHaveBeenCalledWith({
      scenario: 'quiz',
      soundEnabled: false,
      volume: 1,
      audioCue: { kind: 'branch_clear', milestoneStep: null },
    })
  })
})
