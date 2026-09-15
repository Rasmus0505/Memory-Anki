import { describe, expect, it } from 'vitest'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { formatQuizAttemptStats, withOptimisticQuizAttempt } from './quizAttemptStats'

const baseQuestion = {
  id: 1,
  palace_id: 1,
  sort_order: 0,
  correct_count: 16,
  incorrect_count: 13,
  attempt_count: 29,
  segment_ids: [],
  question_type: 'multiple_choice',
  stem: 'stem',
  options: [],
  answer_payload: { correct_option_id: 'A' },
  analysis: '',
  source_meta: {
    source_kind: 'manual',
    page_numbers: null,
    image_names: null,
    extra_prompt: '',
    ai_call_log_id: null,
    generated_at: '',
    generation_mode: 'manual',
  },
  created_at: null,
  updated_at: null,
} satisfies PalaceQuizQuestion

describe('quizAttemptStats', () => {
  it('formats correct_count/attempt_count including 0/0', () => {
    expect(formatQuizAttemptStats(16, 29)).toBe('16/29')
    expect(formatQuizAttemptStats(0, 0)).toBe('0/0')
  })

  it('optimistically bumps attempt and correct counts', () => {
    expect(withOptimisticQuizAttempt(baseQuestion, true)).toMatchObject({
      attempt_count: 30,
      correct_count: 17,
      incorrect_count: 13,
    })
    expect(withOptimisticQuizAttempt(baseQuestion, false)).toMatchObject({
      attempt_count: 30,
      correct_count: 16,
      incorrect_count: 14,
    })
  })
})
