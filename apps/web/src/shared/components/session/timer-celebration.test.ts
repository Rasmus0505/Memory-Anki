import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'
import { createReviewFeedbackSettingsFixture } from '@/shared/feedback/reviewFeedbackSettings.fixture'

const notifyFeedback = vi.hoisted(() => vi.fn())
vi.mock('@/shared/feedback/feedbackCenter', () => ({ notifyFeedback }))

function emit(overrides: Partial<Parameters<typeof emitTimerCelebration>[0]> = {}) {
  const settings = createReviewFeedbackSettingsFixture()
  emitTimerCelebration({
    completionCount: 1,
    kind: 'primary',
    reducedMotion: false,
    soundEnabled: true,
    volume: 1,
    preset: 'balanced',
    scene: settings.scenes.timerRound,
    ...overrides,
  })
  return notifyFeedback.mock.calls.at(-1)?.[0]
}

describe('emitTimerCelebration', () => {
  beforeEach(() => notifyFeedback.mockClear())

  it('uses the scene confetti preset when one is configured', () => {
    const settings = createReviewFeedbackSettingsFixture()
    const request = emit({ scene: { ...settings.scenes.timerRound, confettiPreset: 'stars' } })
    expect(request.celebration.preset).toBe('stars')
  })

  it('escalates by feedback preset when the scene has no explicit choice', () => {
    const settings = createReviewFeedbackSettingsFixture()
    const scene = { ...settings.scenes.timerRound, confettiPreset: undefined }

    expect(emit({ scene, preset: 'focus' }).celebration.preset).toBe('stars')
    expect(emit({ scene, preset: 'balanced' }).celebration.preset).toBe('school_pride')
    expect(emit({ scene, preset: 'motivating', completionCount: 1 }).celebration.preset).toBe(
      'fireworks',
    )
    expect(emit({ scene, preset: 'motivating', completionCount: 8 }).celebration.preset).toBe(
      'school_pride',
    )
  })

  it('passes the already-boosted volume straight through', () => {
    // The caller resolves base volume x scene boost, so there is exactly one
    // place that multiplies rather than two invisible ones.
    expect(emit({ volume: 1.8 }).celebration.volume).toBe(1.8)
  })

  it('stays silent when the scene is disabled', () => {
    const settings = createReviewFeedbackSettingsFixture()
    const request = emit({ scene: { ...settings.scenes.timerRound, enabled: false } })
    expect(request.celebration).toBe(false)
    expect(request.soundEnabled).toBe(false)
  })
})
