import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  FEEDBACK_CONFETTI_PRESETS,
  FEEDBACK_CONFETTI_PRESET_LABELS,
  applyFeedbackPreset,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
  sanitizeReviewFeedbackSettings,
  writeReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

describe('reviewFeedbackSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readReviewFeedbackSettings()).toEqual(DEFAULT_REVIEW_FEEDBACK_SETTINGS)
    expect(DEFAULT_REVIEW_FEEDBACK_SETTINGS.schemaVersion).toBe(4)
  })

  it('migrates legacy intensity into the preset model', () => {
    expect(sanitizeReviewFeedbackSettings({ globalIntensity: 'quiet' }).preset).toBe('focus')
    expect(sanitizeReviewFeedbackSettings({ globalIntensity: 'balanced' }).preset).toBe('balanced')
    expect(sanitizeReviewFeedbackSettings({ globalIntensity: 'immersive' }).preset).toBe('motivating')
  })

  it('folds a legacy quiet mode into the sound and animation switches', () => {
    // v3 `mode` gated the same paths those two switches gate. Dropping it must
    // not make a silent profile suddenly audible.
    const sanitized = sanitizeReviewFeedbackSettings({ mode: 'quiet', soundEnabled: true })
    expect(sanitized.soundEnabled).toBe(false)
    expect(sanitized.animationEnabled).toBe(false)
    expect('mode' in sanitized).toBe(false)
  })

  it('drops fields that nothing ever read', () => {
    const sanitized = sanitizeReviewFeedbackSettings({
      visualStyle: 'focus_light',
      soundTheme: 'classic',
      baseVolumeMultiplier: 4,
      globalIntensity: 'balanced',
      scenes: { timer: { enabled: true }, quiz: { enabled: true } },
    }) as unknown as Record<string, unknown>

    for (const key of ['visualStyle', 'soundTheme', 'baseVolumeMultiplier', 'globalIntensity']) {
      expect(sanitized[key]).toBeUndefined()
    }
    const scenes = sanitized.scenes as Record<string, unknown>
    expect(scenes.timer).toBeUndefined()
    expect(scenes.quiz).toBeUndefined()
    expect(scenes.timerInterval).toBeDefined()
    expect(scenes.timerRound).toBeDefined()
  })

  it('treats channel switches as tri-state and lets presets supply the default', () => {
    const followsPreset = sanitizeReviewFeedbackSettings({ preset: 'focus' })
    expect(followsPreset.learningSoundsEnabled).toBeNull()
    expect(resolveFeedbackChannels(followsPreset).learningSounds).toBe(false)
    expect(resolveFeedbackChannels({ ...followsPreset, preset: 'balanced' }).learningSounds).toBe(true)

    const explicit = sanitizeReviewFeedbackSettings({ preset: 'focus', learningSoundsEnabled: true })
    expect(explicit.learningSoundsEnabled).toBe(true)
    expect(resolveFeedbackChannels(explicit).learningSounds).toBe(true)
  })

  it('never overwrites an explicit channel choice when a preset is applied', () => {
    // Regression: switching preset used to force completion effects back on,
    // so closing that channel could not survive a single preset click.
    let settings = sanitizeReviewFeedbackSettings({ completionEffectsEnabled: false })
    for (const preset of ['focus', 'motivating', 'balanced'] as const) {
      settings = applyFeedbackPreset(settings, preset)
      expect(settings.completionEffectsEnabled).toBe(false)
      expect(resolveFeedbackChannels(settings).completionEffects).toBe(false)
    }
  })

  it('lets presets drive the timer scenes now that they live here', () => {
    const focused = applyFeedbackPreset(DEFAULT_REVIEW_FEEDBACK_SETTINGS, 'focus')
    const motivating = applyFeedbackPreset(DEFAULT_REVIEW_FEEDBACK_SETTINGS, 'motivating')

    expect(focused.scenes.timerRound.confettiAmount).toBeLessThan(
      motivating.scenes.timerRound.confettiAmount,
    )
    expect(focused.scenes.timerInterval.animationEnabled).toBe(false)
  })

  it('exposes exactly five confetti presets with the chinese labels', () => {
    expect(FEEDBACK_CONFETTI_PRESETS).toEqual([
      'random_direction',
      'fireworks',
      'realistic_look',
      'stars',
      'school_pride',
    ])
    expect(FEEDBACK_CONFETTI_PRESET_LABELS).toEqual({
      random_direction: '庆祝',
      fireworks: '爆发',
      realistic_look: '写实',
      stars: '星爆',
      school_pride: '庆典',
    })
  })

  it('writes sanitized scene-based settings', () => {
    const saved = writeReviewFeedbackSettings({
      ...DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      soundEnabled: false,
      volume: 1.75,
      scenes: {
        ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes,
        review: {
          ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.review,
          soundEnabled: false,
          confettiPreset: 'stars',
        },
        timerRound: {
          ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.timerRound,
          confettiAmount: 2.6,
        },
      },
    })

    expect(saved.soundEnabled).toBe(false)
    expect(saved.volume).toBe(1.75)
    expect(saved.scenes.review.soundEnabled).toBe(false)
    expect(saved.scenes.review.confettiPreset).toBe('stars')
    expect(saved.scenes.timerRound.confettiAmount).toBe(2.6)
    // 形容词强度档位已彻底移除
    expect((saved.scenes.review as unknown as Record<string, unknown>).intensity).toBeUndefined()
    expect((saved as unknown as Record<string, unknown>).revealFxIntensity).toBeUndefined()
  })

  it('drops legacy intensity fields from older stored settings without errors', () => {
    const sanitized = sanitizeReviewFeedbackSettings({
      soundEnabled: false,
      animationEnabled: true,
      // 老版本遗留的强度字段，应被静默丢弃
      revealFxIntensity: 'soft',
      criticalFxIntensity: 'full',
      confettiAmount: 1.6,
      scenes: {
        review: { enabled: true, intensity: 'soft', confettiAmount: 0.55, cooldownMs: 900 },
        milestone: { enabled: true, intensity: 'celebration', steps: [4, 8], cooldownMs: 8000 },
        completion: { enabled: true, intensity: 'cinematic', confettiAmount: 1.6, cooldownMs: 12000 },
      },
      celebration: {
        globalCooldownMs: -10,
        milestone: { steps: ['x', -4, 12, 12, 6], cooldownMs: -20 },
      },
    })

    // scenes.milestone.steps 为有效值 [4,8]，优先于 celebration 里的脏数据
    expect(sanitized.scenes.milestone.steps).toEqual([4, 8])
    expect((sanitized.scenes.review as unknown as Record<string, unknown>).intensity).toBeUndefined()
    // 烟花类型按场景默认兜底
    expect(sanitized.scenes.review.confettiPreset).toBe('random_direction')
    expect(sanitized.scenes.milestone.confettiPreset).toBe('fireworks')
    expect(sanitized.scenes.completion.confettiPreset).toBe('stars')
  })

  it('fills missing timer scenes and clamps invalid values', () => {
    const missing = sanitizeReviewFeedbackSettings({
      scenes: {
        review: DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.review,
        milestone: DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.milestone,
        completion: DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.completion,
      },
    })
    expect(missing.scenes.timerRound).toEqual(DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.timerRound)

    const sanitized = sanitizeReviewFeedbackSettings({
      scenes: {
        ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes,
        timerRound: {
          enabled: true,
          soundEnabled: true,
          animationEnabled: false,
          confettiAmount: 99,
          cooldownMs: -40,
          confettiPreset: 'not-a-preset',
          volumeBoost: 99,
        },
      },
    })

    expect(sanitized.scenes.timerRound).toEqual(
      expect.objectContaining({
        enabled: true,
        animationEnabled: false,
        confettiAmount: 3,
        cooldownMs: 0,
        confettiPreset: 'school_pride',
        volumeBoost: 3,
      }),
    )
  })
})
