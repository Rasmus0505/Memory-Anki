import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  FEEDBACK_CONFETTI_PRESETS,
  FEEDBACK_CONFETTI_PRESET_LABELS,
  readReviewFeedbackSettings,
  sanitizeReviewFeedbackSettings,
  writeReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

describe('reviewFeedbackSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(readReviewFeedbackSettings()).toEqual(DEFAULT_REVIEW_FEEDBACK_SETTINGS)
  })

  it('exposes exactly five confetti presets with the new chinese labels', () => {
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

  it('writes sanitized scene-based settings (no intensity field)', () => {
    const saved = writeReviewFeedbackSettings({
      ...DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      mode: 'quiet',
      soundEnabled: false,
      volume: 1.75,
      scenes: {
        ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes,
        review: {
          ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.review,
          soundEnabled: false,
          confettiPreset: 'stars',
        },
        timer: {
          ...DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.timer,
          confettiAmount: 2.6,
        },
      },
    })

    expect(saved.mode).toBe('quiet')
    expect(saved.soundEnabled).toBe(false)
    expect(saved.volume).toBe(1.75)
    expect(saved.scenes.review.soundEnabled).toBe(false)
    expect(saved.scenes.review.confettiPreset).toBe('stars')
    expect(saved.scenes.timer.confettiAmount).toBe(2.6)
    // 形容词强度档位已彻底移除
    expect((saved.scenes.review as unknown as Record<string, unknown>).intensity).toBeUndefined()
    expect((saved as unknown as Record<string, unknown>).revealFxIntensity).toBeUndefined()
    expect((saved as unknown as Record<string, unknown>).criticalFxIntensity).toBeUndefined()
  })

  it('drops legacy intensity fields from older stored settings without errors', () => {
    const sanitized = sanitizeReviewFeedbackSettings({
      mode: 'quiet',
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
        timer: { enabled: true, intensity: 'cinematic', confettiAmount: 2.2, cooldownMs: 12000 },
      },
      celebration: {
        globalCooldownMs: -10,
        milestone: {
          steps: ['x', -4, 12, 12, 6],
          cooldownMs: -20,
        },
      },
    })

    expect(sanitized.mode).toBe('quiet')
    // scenes.milestone.steps 为有效值 [4,8]，优先于 celebration 里的脏数据
    expect(sanitized.scenes.milestone.steps).toEqual([4, 8])
    // 强度字段不应出现在清洗后的结果里
    expect((sanitized.scenes.review as unknown as Record<string, unknown>).intensity).toBeUndefined()
    expect((sanitized.scenes.completion as unknown as Record<string, unknown>).intensity).toBeUndefined()
    // 烟花类型按场景默认兜底
    expect(sanitized.scenes.review.confettiPreset).toBe('random_direction')
    expect(sanitized.scenes.milestone.confettiPreset).toBe('fireworks')
    expect(sanitized.scenes.completion.confettiPreset).toBe('stars')
  })
})
