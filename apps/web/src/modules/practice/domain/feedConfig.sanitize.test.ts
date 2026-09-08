import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  sanitizeFreestyleFeedConfig,
} from './feedConfig'

describe('freestyle feed config', () => {
  it('sanitizes bounds and removes Anki from legacy content', () => {
    const config = sanitizeFreestyleFeedConfig({
      node_limit: 99,
      progress_scopes: ['reinforcement'],
      include_calendar_today_due: true,
      within_palace_order: 'deterministic_shuffle',
      queue_length: 2,
      content: { mindmap_branch: false, quiz_question: false, anki_card: false },
      seed: 0,
    })
    expect(config.queue_length).toBe(5)
    expect(config.seed).toBe(1)
    expect(config.content.mindmap_branch).toBe(true)
    expect(config.content.anki_card).toBe(false)
    expect(config.content.quiz_question).toBe(true)
    expect(config).not.toHaveProperty('node_limit')
    expect(config).not.toHaveProperty('progress_scopes')
    expect(config).not.toHaveProperty('include_calendar_today_due')
    expect(config).not.toHaveProperty('within_palace_order')
  })

  it('keeps defaults for empty input', () => {
    expect(sanitizeFreestyleFeedConfig(null)).toEqual(DEFAULT_FREESTYLE_FEED_CONFIG)
  })

  it('defaults mix_mode to ratio and derives mix_ratio from weights', () => {
    const config = sanitizeFreestyleFeedConfig({
      weights: { mindmap_branch: 3, anki_card: 1, quiz_question: 2 },
    })
    expect(config.mix_mode).toBe('ratio')
    expect(config.mix_ratio).toEqual({ mindmap: 3, quiz: 2 })
    expect(config.bound_quiz_placement).toBe('into_mix')
    expect(config.quiz_mastery_buckets).toEqual(['unseen', 'weak', 'reinforce'])
    expect(config.quiz_scope).toBe('cross_palace_random')
  })

  it('keeps explicit follow_unit and quiz progress scopes', () => {
    const config = sanitizeFreestyleFeedConfig({
      bound_quiz_placement: 'follow_unit',
      quiz_mastery_buckets: ['unseen', 'stable'],
      quiz_scope: 'single_palace_random',
    })
    expect(config.bound_quiz_placement).toBe('follow_unit')
    expect(config.quiz_mastery_buckets).toEqual(['unseen', 'stable'])
    expect(config.quiz_scope).toBe('single_palace_random')
  })

  it('maps legacy expand due_policy to include stable when scopes missing', () => {
    const config = sanitizeFreestyleFeedConfig({
      due_policy: 'due_first_then_expand',
    })
    expect(config.quiz_mastery_buckets).toEqual(['unseen', 'weak', 'reinforce', 'stable'])
  })

  it('infers mindmap_only / quiz_only from content when mix_mode missing', () => {
    expect(
      sanitizeFreestyleFeedConfig({
        content: { mindmap_branch: true, anki_card: false, quiz_question: false },
      }).mix_mode,
    ).toBe('mindmap_only')
    expect(
      sanitizeFreestyleFeedConfig({
        content: { mindmap_branch: false, anki_card: false, quiz_question: true },
      }).mix_mode,
    ).toBe('quiz_only')
  })

  it('keeps explicit mix_mode and clamps mix_ratio', () => {
    const config = sanitizeFreestyleFeedConfig({
      mix_mode: 'random',
      mix_ratio: { mindmap: 99, quiz: 0 },
      bound_quiz_placement: 'into_mix',
    })
    expect(config.mix_mode).toBe('random')
    expect(config.mix_ratio.mindmap).toBe(10)
    expect(config.mix_ratio.quiz).toBe(1)
    expect(config.bound_quiz_placement).toBe('into_mix')
  })

  it('migrates legacy directions into streams and folds english into a subject filter', () => {
    expect(sanitizeFreestyleFeedConfig({ mix_mode: 'quiz_only' })).toMatchObject({
      training_mode: 'quiz',
      mixed_modes: ['quiz'],
    })
    expect(sanitizeFreestyleFeedConfig({
      subject_scope: 'english',
      content: { mindmap_branch: true, anki_card: false, quiz_question: false },
    })).toMatchObject({
      training_mode: 'memory_palace',
      mixed_modes: ['memory_palace'],
      streams: { memory_palace: { subject_scope: 'english', subject_ids: [] } },
    })
    expect(sanitizeFreestyleFeedConfig({
      training_mode: 'mixed',
      mixed_modes: ['english'],
    })).toMatchObject({
      training_mode: 'memory_palace',
      mixed_modes: ['memory_palace'],
      streams: { memory_palace: { subject_scope: 'english' } },
    })
  })

  it('folds a mixed english stream into memory_palace and keeps quiz', () => {
    expect(sanitizeFreestyleFeedConfig({
      training_mode: 'mixed',
      mixed_modes: ['english', 'quiz'],
      streams: {
        english: { due_policy: 'due_only', unit_order: 'random' },
      },
    })).toMatchObject({
      training_mode: 'mixed',
      mixed_modes: ['memory_palace', 'quiz'],
      streams: {
        memory_palace: {
          subject_scope: 'english',
          due_policy: 'due_only',
          unit_order: 'random',
        },
      },
    })
  })

  it('treats mixed memory_palace+english as one palace stream over all subjects', () => {
    expect(sanitizeFreestyleFeedConfig({
      training_mode: 'mixed',
      mixed_modes: ['memory_palace', 'english'],
    })).toMatchObject({
      training_mode: 'memory_palace',
      mixed_modes: ['memory_palace'],
      streams: { memory_palace: { subject_scope: 'all', subject_ids: [] } },
    })
  })

  it('keeps subject_ids as the source of truth over subject_scope', () => {
    const config = sanitizeFreestyleFeedConfig({
      training_mode: 'memory_palace',
      streams: {
        memory_palace: { subject_ids: [7, 7, 0], subject_scope: 'english' },
      },
    })
    expect(config.training_mode).toBe('memory_palace')
    expect(config.streams.memory_palace.subject_ids).toEqual([7])
    expect(config.streams.memory_palace.subject_scope).toBe('all')
    expect(config.mixed_modes).not.toContain('english')
  })
})
